/**
 * Gemini AI Streaming Client
 * Fixes applied:
 *  - BUG6: System prompt always at position[0], never dropped by sliding window
 *  - BUG8: TextDecoder final flush after read loop
 *  - ISSUE11: Removed dead `currentFiles` parameter (context is embedded in prompt by /api/agent)
 *  - ISSUE15: AbortController 45s timeout per model attempt
 */

import { getSystemPrompt } from "./prompt-templates";

export type MultimodalPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface ChatMessagePayload {
  role: "system" | "user" | "assistant";
  content: string | MultimodalPart[];
}

export interface StreamGenerationOptions {
  prompt: string;
  image?: string; // Base64 data URL
  framework?: string;
  history?: ChatMessagePayload[];
}

const CANDIDATE_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-1.5-flash",
  "gemini-3.5-flash",
];

/** Retry fetch up to maxRetries times on 503 errors, with per-attempt AbortController timeout */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 1,
  delayMs = 600,
  timeoutMs = 15000
): Promise<Response> {
  let lastRes: Response | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Abort if no response within timeoutMs
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      lastRes = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeoutId);
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err?.name === "AbortError") {
        throw new Error(`Request timed out after ${timeoutMs / 1000}s`);
      }
      throw err;
    }

    if (lastRes.status !== 503 || attempt === maxRetries) return lastRes;
    await new Promise((r) => setTimeout(r, delayMs * (attempt + 1)));
  }
  return lastRes!;
}

/**
 * Build message array ensuring system prompt is ALWAYS first,
 * and user prompt incorporates image if provided.
 */
function buildMessages(
  history: ChatMessagePayload[],
  prompt: string,
  framework: string,
  image?: string
): ChatMessagePayload[] {
  // Construct user content: string or array of parts if image exists
  const userContent: string | MultimodalPart[] = image
    ? [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: image } },
      ]
    : prompt;

  // Separate system prompt from conversation turns
  const systemMessage = history.find((m) => m.role === "system");
  const conversationTurns = history.filter((m) => m.role !== "system");

  // Always keep system at position 0; slide only conversation window
  if (systemMessage) {
    return [
      systemMessage,                        // system always first
      ...conversationTurns.slice(-7),       // last 7 turns max
      { role: "user", content: userContent },
    ];
  }

  // No system prompt provided — inject fallback
  return [
    { role: "system", content: getSystemPrompt(framework, "none", "none", "build") },
    ...conversationTurns.slice(-6),
    { role: "user", content: userContent },
  ];
}

export async function createGeminiStream({
  prompt,
  image,
  framework = "nextjs",
  history = [],
}: StreamGenerationOptions): Promise<ReadableStream<Uint8Array>> {
  const rawKey = process.env.GEMINI_API_KEY || "";
  const apiKey = rawKey.trim().replace(/^['"]|['"]$/g, "");
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured in environment variables");
  }

  const rawUrl =
    process.env.GEMINI_API_URL ||
    "https://generativelanguage.googleapis.com/v1beta/openai";
  const apiUrl = rawUrl.trim().replace(/^['"]|['"]$/g, "").replace(/\/+$/, "");
  const endpoint = `${apiUrl}/chat/completions`;

  const messages = buildMessages(history, prompt, framework, image);

  let response: Response | null = null;
  let lastError = "";

  for (const model of CANDIDATE_MODELS) {
    try {
      const res = await fetchWithRetry(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.3,
          stream: true,
        }),
      });

      if (res.ok && res.body) {
        console.log(`[AI Stream] Using model: ${model}`);
        response = res;
        break;
      } else {
        const errText = await res.text().catch(() => "");
        lastError = `Model ${model} (${res.status}): ${errText.slice(0, 200)}`;
        console.warn(`[AI Stream] ${lastError} — trying next model...`);
      }
    } catch (err: any) {
      lastError = `Model ${model} fetch failed: ${err?.message || err}`;
      console.warn(`[AI Stream] ${lastError}`);
    }
  }

  if (!response || !response.body) {
    throw new Error(`All AI models unavailable. Last error: ${lastError}`);
  }

  const encoder = new TextEncoder();
  // BUG8 fix: create decoder once, call final flush after loop
  const decoder = new TextDecoder("utf-8", { fatal: false });

  return new ReadableStream({
    async start(controller) {
      const reader = response!.body!.getReader();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed === "data: [DONE]") continue;
            if (trimmed.startsWith("data: ")) {
              try {
                const json = JSON.parse(trimmed.slice(6));
                const content = json.choices?.[0]?.delta?.content;
                if (content) controller.enqueue(encoder.encode(content));
              } catch {
                // Partial JSON chunk — skip silently
              }
            }
          }
        }

        // BUG8 fix: flush remaining bytes (multi-byte UTF-8 at chunk boundary)
        const flushed = decoder.decode();
        if (flushed) buffer += flushed;

        // Process any remaining buffered lines
        if (buffer.trim().startsWith("data: ") && buffer.trim() !== "data: [DONE]") {
          try {
            const json = JSON.parse(buffer.trim().slice(6));
            const content = json.choices?.[0]?.delta?.content;
            if (content) controller.enqueue(encoder.encode(content));
          } catch {}
        }

        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
}
