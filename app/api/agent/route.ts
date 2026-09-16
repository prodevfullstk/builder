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
                             process.env.ORCHESTRATION_ENABLED !== 'false'; // Feature flag

    if (useOrchestration) {
      // Use NEW orchestrated execution path
      console.log(`[Orchestrator] Using orchestrated strategy for ${intent.action} (${orchestrationDecision.subtaskCount} subtasks)`);
      
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

      // Convert orchestration events to SSE format
      const encoder = new TextEncoder();
      const transformedStream = new ReadableStream({
        async start(controller) {
          try {
            for await (const event of orchestrationStream) {
              const sseData = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
              controller.enqueue(encoder.encode(sseData));
            }
            controller.close();
            
            // Track usage
            const duration = Date.now() - startTime;
            trackOrchestrationUsage('orchestrated', orchestrationDecision.subtaskCount || 0, duration);
          } catch (error) {
            console.error('[Orchestrator] Error:', error);
            const errorEvent = `event: error\ndata: ${JSON.stringify({ type: 'error', message: String(error) })}\n\n`;
            controller.enqueue(encoder.encode(errorEvent));
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
    console.log(`[Orchestrator] Using direct strategy for ${intent.action}`);
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
