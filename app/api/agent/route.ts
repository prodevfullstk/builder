import { NextRequest } from "next/server";
import { createGeminiStream } from "@/lib/ai/gemini-stream";
import { getSystemPrompt } from "@/lib/ai/prompt-templates";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const {
      message,
      history = [],
      files = {},
      activeFile = "",
      framework = "nextjs",
      dbProvider = "none",
      authProvider = "none",
      mode = "build",  // "build" | "chat" | "edit"
    } = body;

    if (!message || typeof message !== "string") {
      return new Response(JSON.stringify({ error: "Message is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const systemPrompt = getSystemPrompt(framework, dbProvider, authProvider, mode);

    // Build user content based on mode
    let userContent = message;

    if (mode === "edit" && activeFile && files[activeFile]) {
      userContent = `Current file: ${activeFile}

File content:
\`\`\`
${files[activeFile].slice(0, 8000)}
\`\`\`

User instruction: ${message}`;
    } else if (mode === "build" && Object.keys(files).length > 0) {
      // Provide existing project context for incremental edits
      const fileSummary = Object.entries(files)
        .slice(0, 8)
        .map(([path, content]) => `\`\`\`${path}\n${String(content).slice(0, 800)}\n\`\`\``)
        .join("\n\n");
      userContent = `CURRENT PROJECT (${framework}):\n${fileSummary}\n\nUSER REQUEST: ${message}`;
    }

    const stream = await createGeminiStream({
      prompt: userContent,
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
