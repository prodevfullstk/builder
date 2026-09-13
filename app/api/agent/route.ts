import { NextRequest } from "next/server";
import { createGeminiStream } from "@/lib/ai/gemini-stream";
import { getSystemPrompt } from "@/lib/ai/prompt-templates";
import { authenticateRequest } from "@/lib/auth/server-auth";
import { checkRateLimit } from "@/lib/auth/rate-limiter";

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

    // Authentication gate: requires real Supabase token or explicit demo mode.
    // Blocks anonymous LLM abuse from unauthenticated IPs.
    const authResult = await authenticateRequest(req, { allowDemo: true });
    if (authResult.error || !authResult.user) {
      return new Response(JSON.stringify({ error: authResult.error || "Unauthorized" }), {
        status: authResult.status || 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Rate Limiting Gate (SEC-305 / P1-6)
    const isDemo = authResult.user.authMode === 'demo';
    const rateLimitKey = isDemo ? `demo:${getClientIp(req)}` : `user:${authResult.user.id}`;
    const maxRequests = isDemo ? 10 : 60;
    const rateLimit = checkRateLimit(rateLimitKey, maxRequests, 3600_000);

    if (!rateLimit.allowed) {
      return new Response(
        JSON.stringify({
          error: isDemo
            ? 'Rate limit exceeded: Demo mode is limited to 10 generations per IP per hour. Please sign in to increase limits.'
            : 'Rate limit exceeded: You have reached the maximum of 60 requests per hour.',
        }),
        {
          status: 429,
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

    const systemPrompt = getSystemPrompt(framework, dbProvider, authProvider, mode, skills);

    // Build user content based on mode
    let userContent = message;

    if (mode === "edit" && activeFile && files[activeFile]) {
      userContent = `Current file: ${activeFile}

File content:
\`\`\`
${files[activeFile].slice(0, 8000)}
\`\`\`

User instruction: ${message}`;
    } else if (mode === "visual-fix") {
      // Prioritize activeFile and key component files for screenshot-based repairs
      const mentionedPaths = Object.keys(files).filter((p) =>
        message.toLowerCase().includes(p.toLowerCase())
      );
      if (activeFile && !mentionedPaths.includes(activeFile) && files[activeFile]) {
        mentionedPaths.unshift(activeFile);
      }

      const fileSummary = Object.entries(files)
        .sort(([a], [b]) => {
          const aPri = mentionedPaths.includes(a) ? 1 : 0;
          const bPri = mentionedPaths.includes(b) ? 1 : 0;
          return bPri - aPri;
        })
        .slice(0, 14)
        .map(([path, content]) => {
          const isTarget = mentionedPaths.includes(path);
          const maxLen = isTarget ? 6000 : 2000;
          return `\`\`\`${path}\n${String(content).slice(0, maxLen)}\n\`\`\``;
        })
        .join("\n\n");

      userContent = `VISUAL BUG / LAYOUT FIX REQUEST BASED ON ATTACHED SCREENSHOT:
${message}

CURRENT PROJECT FILES (${framework}):
${fileSummary}

SURGICAL REPAIR INSTRUCTIONS:
1. Carefully compare the attached screenshot with the existing code above to identify which component is causing the issue.
2. ❌ DO NOT REWRITE OR REGENERATE WORKING FILES!
3. Output ONLY the single modified file (or minimal set of files) that resolves the visual discrepancy.
4. Use standard markdown code block: \`\`\`tsx filename=path/to/file.tsx with the full updated component code.`;
    } else if (mode === "auto-fix") {
      // Prioritize files cited in the error trace, package.json, and the active file
      const mentionedPaths = Object.keys(files).filter((p) =>
        message.toLowerCase().includes(p.toLowerCase())
      );
      if (files["package.json"] && !mentionedPaths.includes("package.json")) {
        mentionedPaths.push("package.json");
      }
      if (activeFile && !mentionedPaths.includes(activeFile) && files[activeFile]) {
        mentionedPaths.unshift(activeFile);
      }

      const fileSummary = Object.entries(files)
        .sort(([a], [b]) => {
          const aPri = mentionedPaths.includes(a) ? 1 : 0;
          const bPri = mentionedPaths.includes(b) ? 1 : 0;
          return bPri - aPri;
        })
        .slice(0, 12)
        .map(([path, content]) => {
          const isTarget = mentionedPaths.includes(path);
          const maxLen = isTarget ? 6000 : 1500;
          return `\`\`\`${path}\n${String(content).slice(0, maxLen)}\n\`\`\``;
        })
        .join("\n\n");
      userContent = `PREVIEW SANDBOX ERROR DETECTED:\n${message}\n\nCURRENT PROJECT FILES (${framework}):\n${fileSummary}\n\nDIAGNOSTIC PROTOCOL REQUIRED:\n1. Identify error category (TYPE_A to TYPE_E).\n2. Apply minimal surgical fix to the offending file without deleting working features or reducing state.\n3. Output corrected file via <TOOL_CALL> (edit_file/write_file) or corrected <FILES> block.`;
    } else if (mode === "build" && Object.keys(files).length > 0) {
      // Provide existing project context for incremental edits & fixes
      // Prioritize files mentioned in the prompt, activeFile, and requirements.md
      const mentionedPaths = Object.keys(files).filter((p) =>
        message.toLowerCase().includes(p.toLowerCase())
      );
      if (activeFile && !mentionedPaths.includes(activeFile) && files[activeFile]) {
        mentionedPaths.unshift(activeFile);
      }
      if (files['requirements.md'] && !mentionedPaths.includes('requirements.md')) {
        mentionedPaths.unshift('requirements.md');
      }

      const fileSummary = Object.entries(files)
        .sort(([a], [b]) => {
          const aPri = mentionedPaths.includes(a) ? 1 : 0;
          const bPri = mentionedPaths.includes(b) ? 1 : 0;
          return bPri - aPri;
        })
        .slice(0, 16)
        .map(([path, content]) => {
          const isTarget = mentionedPaths.includes(path);
          const maxLen = isTarget ? 6000 : 2000;
          return `\`\`\`${path}\n${String(content).slice(0, maxLen)}\n\`\`\``;
        })
        .join("\n\n");
      const requirementsContext = files['requirements.md']
        ? `PROJECT SPECIFICATION & ARCHITECTURE REQUIREMENTS:\n${files['requirements.md']}\n\n`
        : '';
      userContent = `${requirementsContext}CURRENT PROJECT (${framework}):\n${fileSummary}\n\nINCREMENTAL EDIT REQUEST:\n${message}\n\nINSTRUCTIONS FOR INCREMENTAL FIX/EDIT:\nApply the requested changes to the project. Output the modified or new files in standard code blocks (e.g. \`\`\`tsx filename=path/to/file) or via <TOOL_CALL>. Preserve all existing working features, routes, and styling! Adhere strictly to the project requirements above.`;
    }

    const stream = await createGeminiStream({
      prompt: userContent,
      image: typeof image === "string" && image.startsWith("data:image/") ? image : undefined,
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
