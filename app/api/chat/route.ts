/**
 * Legacy route: /api/chat
 * Re-routes directly to /api/agent for unified agent processing in "chat" mode
 */
import { NextRequest } from "next/server";
import { POST as agentPost, maxDuration, dynamic } from "../agent/route";

export { maxDuration, dynamic };

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const forwardBody = {
      message: body.message || body.prompt || "",
      history: body.history || [],
      framework: body.framework || "nextjs",
      mode: "chat",
    };

    const nextReq = new NextRequest(req.url, {
      method: "POST",
      headers: req.headers,
      body: JSON.stringify(forwardBody),
    });

    return agentPost(nextReq);
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || "Failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
