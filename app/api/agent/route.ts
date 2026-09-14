import { NextRequest } from "next/server";
import { createGeminiStream } from "@/lib/ai/gemini-stream";
import { getSystemPrompt } from "@/lib/ai/prompt-templates";
import { authenticateRequest } from "@/lib/auth/server-auth";
import { checkRateLimitDistributed } from "@/lib/auth/rate-limiter";
import { parseIntentFromPrompt, validateIntent } from "@/lib/ai/intent-contract";
import { buildRetrievalContext } from "@/lib/workspace/project-retrieval";
import { validateImageUpload } from "@/lib/vision/image-hardening";
import { createVisualSpec } from "@/lib/vision/visual-spec";

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

    // 2. Authentication gate: requires real Supabase token or explicit demo mode.
    const authResult = await authenticateRequest(req, { allowDemo: true });
    if (authResult.error || !authResult.user) {
      return new Response(JSON.stringify({ error: authResult.error || "Unauthorized" }), {
        status: authResult.status || 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 3. Rate Limiting Gate (SEC-305 / SEC-402)
    const isDemo = authResult.user.authMode === 'demo';
    const rateLimitKey = isDemo ? `demo:${getClientIp(req)}` : `user:${authResult.user.id}`;
    const maxRequests = isDemo ? 10 : 60;
    const rateLimit = await checkRateLimitDistributed(rateLimitKey, maxRequests, 3600_000);

    if (!rateLimit.allowed) {
      const isUnavailable = rateLimit.error === 'Distributed rate limiting unavailable';
      const statusCode = isUnavailable ? 503 : 429;
      return new Response(
        JSON.stringify({
          error: isUnavailable
            ? 'Rate limiting service is temporarily unavailable. Request rejected to prevent abuse.'
            : isDemo
            ? 'Rate limit exceeded: Demo mode is limited to 10 generations per IP per hour. Please sign in to increase limits.'
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
      userContent = `Current file: ${activeFile}

File content:
\`\`\`
${files[activeFile].slice(0, 8000)}
\`\`\`

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

    const stream = await createGeminiStream({
      prompt: userContent,
      image: validatedImageRef?.dataUrl,
      framework,
      history: [
        { role: "system", content: systemPrompt },
        ...history.slice(-6),
      ],
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Content-Type-Options": "nosniff",
        "Connection": "keep-alive",
        "X-Agent-Mode": mode,
        "X-Intent-Action": intent.action,
        "X-Intent-Id": intent.id,
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
