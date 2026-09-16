import { NextRequest } from "next/server";
import { createGeminiStream } from "@/lib/ai/gemini-stream";
import { getSystemPrompt } from "@/lib/ai/prompt-templates";
import { authenticateRequest } from "@/lib/auth/server-auth";
import { checkRateLimitDistributed } from "@/lib/auth/rate-limiter";
import { parseIntentFromPrompt, validateIntent } from "@/lib/ai/intent-contract";
import { buildRetrievalContext } from "@/lib/workspace/project-retrieval";
import { validateImageUpload } from "@/lib/vision/image-hardening";
import { createVisualSpec } from "@/lib/vision/visual-spec";
import { createTypedAgentSSEStream } from "@/lib/ai/stream-events";
import { orchestrateRequest, decideOrchestrationStrategy, trackOrchestrationUsage } from "@/lib/ai/orchestrator";

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.headers.get('x-real-ip') || '127.0.0.1';
}

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const {
      message,
      image,
      history = [],
      files = {},
      activeFile = "",
      framework = "nextjs",
      dbProvider = "none",
      authProvider = "none",
      mode = "build",  // "build" | "chat" | "edit" | "auto-fix"
      skills = undefined, // optional custom skill IDs
    } = body;

    if (!message || typeof message !== "string") {
      return new Response(JSON.stringify({ error: "Message is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 1. Image Upload Hardening (SEC-VISION-101 / Section 17)
    let validatedImageRef;
    if (image !== undefined && image !== null) {
      const imgValidation = validateImageUpload(image);
      if (!imgValidation.valid) {
        return new Response(JSON.stringify({ error: `Invalid image upload: ${imgValidation.error}` }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
      validatedImageRef = imgValidation.imageReference;
    }

    // 2. Authentication gate: requires cryptographically verified Supabase token.
    const authResult = await authenticateRequest(req);
    if (authResult.error || !authResult.user) {
      return new Response(JSON.stringify({ error: authResult.error || "Authentication required. Please sign in to develop projects." }), {
        status: authResult.status || 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 3. Rate Limiting Gate (SEC-305 / SEC-402)
    const rateLimitKey = `user:${authResult.user.id}`;
    const maxRequests = 60;
    const rateLimit = await checkRateLimitDistributed(rateLimitKey, maxRequests, 3600_000);

    if (!rateLimit.allowed) {
      const isUnavailable = rateLimit.error === 'Distributed rate limiting unavailable';
      const statusCode = isUnavailable ? 503 : 429;
      return new Response(
        JSON.stringify({
          error: isUnavailable
            ? 'Rate limiting service is temporarily unavailable. Request rejected to prevent abuse.'
            : 'Rate limit exceeded: You have reached the maximum of 60 requests per hour.',
        }),
        {
          status: statusCode,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': String(rateLimit.resetSeconds),
            'X-RateLimit-Limit': String(rateLimit.limit),
            'X-RateLimit-Remaining': String(rateLimit.remaining),
            'X-RateLimit-Reset': String(rateLimit.resetSeconds),
          },
        }
      );
    }

    // 4. Canonical Intent Contract & Validation (Section 1)
    const intent = parseIntentFromPrompt({
      prompt: message,
      framework,
      hasImage: Boolean(validatedImageRef),
      imageContext: validatedImageRef ? {
        hasImage: true,
        imageType: validatedImageRef.mimeType,
        dataUrl: validatedImageRef.dataUrl,
        referenceId: validatedImageRef.id,
      } : undefined,
      currentFiles: files,
      activeFile,
      mode, // FIXED: Now passing mode parameter to intent parser
    });

    const intentValidation = validateIntent(intent);
    if (!intentValidation.valid) {
      return new Response(
        JSON.stringify({ error: `Intent Contract Violation: ${intentValidation.errors.join("; ")}` }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // 5. Deterministic Project Intelligence & Workspace Retrieval (Section 2)
    const retrievalContext = buildRetrievalContext(files, intent);

    // 6. VisualSpec Generation for Vision Requests (Section 8)
    let visualSpec;
    if (validatedImageRef) {
      visualSpec = createVisualSpec({
        imageReference: validatedImageRef,
        visualPrompt: message,
      });
    }

    const systemPrompt = getSystemPrompt(framework, dbProvider, authProvider, mode, skills);

    // 7. Ground User Prompt with Auditable Retrieval & Intent Context
    let userContent = message;

    if (mode === "edit" && activeFile && files[activeFile]) {
      const otherSnippets = retrievalContext.retrievedSnippets
        .filter((s) => s.path !== activeFile)
        .map((s) => `\`\`\`${s.path} (${s.relevanceReason})\n${s.content}\n\`\`\``)
        .join("\n\n");
      const workspaceContext = otherSnippets ? `\n\nRELATED WORKSPACE CONTEXT:\n${otherSnippets}\n` : '';

      userContent = `Current file: ${activeFile}

File content:
\`\`\`
${files[activeFile].slice(0, 8000)}
\`\`\`
${workspaceContext}
User instruction: ${message}`;
    } else if (mode === "visual-fix" || intent.action === 'VISUAL_EDIT' || intent.action === 'VISUAL_RECREATE') {
      const snippets = retrievalContext.retrievedSnippets
        .map((s) => `\`\`\`${s.path} (${s.relevanceReason})\n${s.content}\n\`\`\``)
        .join("\n\n");

      const visualSpecSection = visualSpec
        ? `STRUCTURED VISUAL SPECIFICATION:\n${JSON.stringify(visualSpec, null, 2)}\n\n`
        : '';

      userContent = `VISUAL BUG / SCREENSHOT IMPLEMENTATION REQUEST:
${message}

${visualSpecSection}RELEVANT WORKSPACE CONTEXT (${framework}):
${snippets}

SURGICAL REPAIR INSTRUCTIONS:
1. Ground implementation strictly in the VisualSpec and retrieved components above.
2. ❌ DO NOT REWRITE OR REGENERATE WORKING UNRELATED FILES!
3. Output the minimal set of files resolving the requirement via <FILES> or <PATCHES>.`;
    } else if (mode === "auto-fix" || intent.action === 'FIX_BUG') {
      const snippets = retrievalContext.retrievedSnippets
        .map((s) => `\`\`\`${s.path} (${s.relevanceReason})\n${s.content}\n\`\`\``)
        .join("\n\n");

      userContent = `PREVIEW SANDBOX ERROR DETECTED:
${message}

RELEVANT WORKSPACE CONTEXT (${framework}):
${snippets}

DIAGNOSTIC PROTOCOL REQUIRED:
1. Identify error root cause.
2. Apply minimal surgical fix to offending file(s).
3. Output corrected file via standard code block, <FILES>, or <PATCHES>.`;
    } else if (Object.keys(files).length > 0) {
      // Incremental edit grounded in retrieval context
      const snippets = retrievalContext.retrievedSnippets
        .map((s) => `\`\`\`${s.path} (${s.relevanceReason})\n${s.content}\n\`\`\``)
        .join("\n\n");

      const requirementsContext = files['requirements.md']
        ? `PROJECT SPECIFICATION & ARCHITECTURE REQUIREMENTS:\n${files['requirements.md']}\n\n`
        : '';

      const criteriaContext = intent.acceptanceCriteria.length > 0
        ? `ACCEPTANCE CRITERIA TO SATISFY:\n${intent.acceptanceCriteria.map((c) => `- [${c.type}] ${c.criterion}`).join('\n')}\n\n`
        : '';

      userContent = `${requirementsContext}${criteriaContext}RELEVANT RETRIEVED WORKSPACE FILES (${framework}):
${snippets}

INCREMENTAL EDIT REQUEST:
${message}

INSTRUCTIONS:
Apply the requested changes. Output modified/new files via standard code blocks or <FILES> / <PATCHES>. Preserve all existing working features and dependencies!`;
    }

    const rawStream = await createGeminiStream({
      prompt: userContent,
      image: validatedImageRef?.dataUrl,
      framework,
      history: [
        { role: "system", content: systemPrompt },
        ...history.slice(-6),
      ],
    });

    const runId = 'run_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 7);

    // === NEW: Orchestration Decision Logic ===
    // Decide if we should use orchestrated multi-step execution or direct LLM call
    const orchestrationDecision = decideOrchestrationStrategy(intent);
    const useOrchestration = orchestrationDecision.strategy === 'orchestrated' && 
                             process.env.ORCHESTRATION_ENABLED !== 'false'; // Feature flag (default: enabled)
    
    // TELEMETRY: Log orchestration decision for monitoring
    console.log(`[🧠 Brain Decision] Intent: ${intent.action}, Strategy: ${orchestrationDecision.strategy}, Subtasks: ${orchestrationDecision.subtaskCount || 0}, Enabled: ${useOrchestration}`);
    
    if (useOrchestration) {
      console.log('[🧠 Brain Active] Using multi-step orchestrated execution with intelligent task planning');
      console.log(`[🧠 Brain Plan] Breaking task into ${orchestrationDecision.subtaskCount} subtasks`);
    } else {
      console.log('[⚡ Brain Bypassed] Falling back to direct LLM call (simple mode)');
    }

    if (useOrchestration) {
      // Use NEW orchestrated execution path
      console.log(`[🧠 Orchestrator] Using orchestrated strategy for ${intent.action} (${orchestrationDecision.subtaskCount} subtasks)`);
      
      const startTime = Date.now();
      const orchestrationStream = orchestrateRequest({
        intent,
        currentFiles: files,
        framework,
        dbProvider,
        authProvider,
        mode,
        skills,
        userPrompt: userContent,
      });

      // ⚠️ CRITICAL FIX: Transform orchestration events to STANDARD stream events
      // The client expects standard SSE events (text_delta, file_start, file_complete)
      // NOT raw orchestration events (orchestration_start, plan_generated, subtask_complete)
      const encoder = new TextEncoder();
      let sequenceId = 0;
      
      const transformedStream = new ReadableStream({
        async start(controller) {
          try {
            // Emit standard start event
            const startEvent = {
              type: 'start',
              sequenceId: ++sequenceId,
              timestamp: new Date().toISOString(),
              messageId: runId,
              role: 'assistant',
            };
            controller.enqueue(encoder.encode(`event: start\ndata: ${JSON.stringify(startEvent)}\n\n`));
            
            // Emit intent event
            const intentEvent = {
              type: 'intent',
              sequenceId: ++sequenceId,
              timestamp: new Date().toISOString(),
              intent,
            };
            controller.enqueue(encoder.encode(`event: intent\ndata: ${JSON.stringify(intentEvent)}\n\n`));
            
            let planEmitted = false;
            const filesGenerated = new Set<string>();
            
            for await (const orchEvent of orchestrationStream) {
              console.log(`[🧠 Orchestrator Event] ${orchEvent.type}:`, orchEvent.data);
              
              // Transform orchestration events to standard stream events
              if (orchEvent.type === 'orchestration_start') {
                // Emit plan event with orchestration info
                const planEvent = {
                  type: 'plan',
                  sequenceId: ++sequenceId,
                  timestamp: new Date().toISOString(),
                  steps: orchEvent.data?.plan?.subtasks?.map((s: any) => s.description || s) || ['Planning multi-step execution'],
                  milestones: orchEvent.data?.plan?.subtasks?.map((s: any, idx: number) => ({
                    id: `milestone-${idx + 1}`,
                    title: s.description || s,
                    status: 'pending',
                  })) || [],
                  estimatedFiles: orchEvent.data?.plan?.targetFiles || [],
                };
                controller.enqueue(encoder.encode(`event: plan\ndata: ${JSON.stringify(planEvent)}\n\n`));
                planEmitted = true;
              } else if (orchEvent.type === 'plan_generated' && !planEmitted) {
                // Emit plan event from plan_generated
                const subtasks = orchEvent.data?.plan?.subtasks || [];
                const planEvent = {
                  type: 'plan',
                  sequenceId: ++sequenceId,
                  timestamp: new Date().toISOString(),
                  steps: subtasks.map((s: any) => s.description || 'Execute subtask'),
                  milestones: subtasks.map((s: any, idx: number) => ({
                    id: s.id || `milestone-${idx + 1}`,
                    title: s.description,
                    status: 'pending',
                  })),
                  estimatedFiles: subtasks.flatMap((s: any) => s.targetFiles || []),
                };
                controller.enqueue(encoder.encode(`event: plan\ndata: ${JSON.stringify(planEvent)}\n\n`));
                planEmitted = true;
              } else if (orchEvent.type === 'subtask_start') {
                // Emit plan_step_start for subtask
                const stepEvent = {
                  type: 'plan_step_start',
                  sequenceId: ++sequenceId,
                  timestamp: new Date().toISOString(),
                  stepId: orchEvent.data?.subtaskId || 'step-' + sequenceId,
                  title: orchEvent.data?.description || 'Executing subtask',
                };
                controller.enqueue(encoder.encode(`event: plan_step_start\ndata: ${JSON.stringify(stepEvent)}\n\n`));
              } else if (orchEvent.type === 'subtask_complete') {
                // Emit file events for completed subtask
                const files = orchEvent.data?.files || {};
                for (const [path, content] of Object.entries(files)) {
                  if (!filesGenerated.has(path)) {
                    filesGenerated.add(path);
                    
                    // file_start
                    controller.enqueue(encoder.encode(`event: file_start\ndata: ${JSON.stringify({
                      type: 'file_start',
                      sequenceId: ++sequenceId,
                      timestamp: new Date().toISOString(),
                      path,
                      operation: 'create',
                    })}\n\n`));
                    
                    // file_delta (send content in chunks for streaming effect)
                    const contentStr = String(content);
                    const chunkSize = 500;
                    for (let i = 0; i < contentStr.length; i += chunkSize) {
                      const chunk = contentStr.slice(i, i + chunkSize);
                      controller.enqueue(encoder.encode(`event: file_delta\ndata: ${JSON.stringify({
                        type: 'file_delta',
                        sequenceId: ++sequenceId,
                        timestamp: new Date().toISOString(),
                        path,
                        delta: chunk,
                      })}\n\n`));
                    }
                    
                    // file_complete
                    controller.enqueue(encoder.encode(`event: file_complete\ndata: ${JSON.stringify({
                      type: 'file_complete',
                      sequenceId: ++sequenceId,
                      timestamp: new Date().toISOString(),
                      path,
                      sizeBytes: contentStr.length,
                      hash: '',
                    })}\n\n`));
                  }
                }
                
                // Emit plan_step_complete
                controller.enqueue(encoder.encode(`event: plan_step_complete\ndata: ${JSON.stringify({
                  type: 'plan_step_complete',
                  sequenceId: ++sequenceId,
                  timestamp: new Date().toISOString(),
                  stepId: orchEvent.data?.subtaskId || 'step-' + sequenceId,
                  summary: `Completed: ${orchEvent.data?.filesModified || 0} files modified`,
                })}\n\n`));
              } else if (orchEvent.type === 'text_delta') {
                // Pass through text_delta directly
                controller.enqueue(encoder.encode(`event: text_delta\ndata: ${JSON.stringify({
                  type: 'text_delta',
                  sequenceId: ++sequenceId,
                  timestamp: new Date().toISOString(),
                  delta: orchEvent.data?.delta || '',
                })}\n\n`));
              } else if (orchEvent.type === 'orchestration_complete') {
                // Emit final files and complete event
                const finalFiles = orchEvent.data?.files || {};
                
                // Emit any remaining files not yet sent
                for (const [path, content] of Object.entries(finalFiles)) {
                  if (!filesGenerated.has(path)) {
                    filesGenerated.add(path);
                    
                    controller.enqueue(encoder.encode(`event: file_start\ndata: ${JSON.stringify({
                      type: 'file_start',
                      sequenceId: ++sequenceId,
                      timestamp: new Date().toISOString(),
                      path,
                      operation: 'create',
                    })}\n\n`));
                    
                    const contentStr = String(content);
                    controller.enqueue(encoder.encode(`event: file_delta\ndata: ${JSON.stringify({
                      type: 'file_delta',
                      sequenceId: ++sequenceId,
                      timestamp: new Date().toISOString(),
                      path,
                      delta: contentStr,
                    })}\n\n`));
                    
                    controller.enqueue(encoder.encode(`event: file_complete\ndata: ${JSON.stringify({
                      type: 'file_complete',
                      sequenceId: ++sequenceId,
                      timestamp: new Date().toISOString(),
                      path,
                      sizeBytes: contentStr.length,
                      hash: '',
                    })}\n\n`));
                  }
                }
                
                // Emit complete event
                const completeEvent = {
                  type: 'complete',
                  sequenceId: ++sequenceId,
                  timestamp: new Date().toISOString(),
                  totalDurationMs: orchEvent.data?.totalDurationMs || (Date.now() - startTime),
                  committed: true,
                };
                controller.enqueue(encoder.encode(`event: complete\ndata: ${JSON.stringify(completeEvent)}\n\n`));
              } else if (orchEvent.type === 'orchestration_error' || orchEvent.type === 'subtask_error') {
                // Emit error event
                const errorEvent = {
                  type: 'error',
                  sequenceId: ++sequenceId,
                  timestamp: new Date().toISOString(),
                  code: 'ORCHESTRATION_ERROR',
                  message: orchEvent.data?.error || 'Orchestration error occurred',
                  fatal: false,
                };
                controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify(errorEvent)}\n\n`));
              }
            }
            
            controller.close();
            
            // Track usage
            const duration = Date.now() - startTime;
            trackOrchestrationUsage('orchestrated', orchestrationDecision.subtaskCount || 0, duration);
            console.log(`[🧠 Orchestrator] Completed in ${duration}ms with ${filesGenerated.size} files generated`);
          } catch (error: any) {
            console.error('[🧠 Orchestrator] Error:', error);
            const errorEvent = {
              type: 'error',
              sequenceId: ++sequenceId,
              timestamp: new Date().toISOString(),
              code: 'ORCHESTRATION_FATAL',
              message: error?.message || String(error),
              fatal: true,
            };
            controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify(errorEvent)}\n\n`));
            controller.close();
          }
        },
      });

      return new Response(transformedStream, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          "X-Content-Type-Options": "nosniff",
          "Connection": "keep-alive",
          "X-Agent-Mode": mode,
          "X-Intent-Action": intent.action,
          "X-Intent-Id": intent.id,
          "X-Run-Id": runId,
          "X-Orchestration": "enabled",
          "X-Subtasks": String(orchestrationDecision.subtaskCount || 0),
        },
      });
    }

    // === EXISTING: Direct LLM stream path (fallback) ===
    console.log(`[⚡ Direct Mode] Using direct strategy for ${intent.action} (orchestration not beneficial)`);
    trackOrchestrationUsage('direct', 0, 0);

    // Formulate dynamic, prompt-grounded milestones
    const dynamicSteps: string[] = [];
    if (intent.requirements && intent.requirements.length > 0) {
      for (const req of intent.requirements.slice(0, 5)) {
        dynamicSteps.push(req);
      }
    }
    if (dynamicSteps.length === 0) {
      dynamicSteps.push(
        `Analyze ${framework} architecture for ${intent.targetDescription || intent.action}`,
        `Synthesize components and layout`,
        `Verify candidate build and preview sandbox`
      );
    }

    const typedStream = createTypedAgentSSEStream({
      rawStream,
      intent,
      runId,
      planSteps: dynamicSteps,
      milestones: dynamicSteps.map((step, idx) => ({
        id: `milestone-${idx + 1}`,
        title: step,
        order: idx + 1,
        status: 'pending',
      })),
      retrievedSnippets: retrievalContext?.retrievedSnippets || [],
    });

    return new Response(typedStream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Content-Type-Options": "nosniff",
        "Connection": "keep-alive",
        "X-Agent-Mode": mode,
        "X-Intent-Action": intent.action,
        "X-Intent-Id": intent.id,
        "X-Run-Id": runId,
      },
    });
  } catch (error: any) {
    console.error("API /api/agent error:", error);
    return new Response(
      JSON.stringify({ error: error?.message || "Agent request failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
