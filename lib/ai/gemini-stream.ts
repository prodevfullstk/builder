/**
 * Gemini AI Streaming Client
 * Supports the new /api/agent unified endpoint with full context passing
 */

import { getSystemPrompt } from "./prompt-templates";

export interface ChatMessagePayload {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface StreamGenerationOptions {
  prompt: string;
  framework?: string;
  history?: ChatMessagePayload[];
  currentFiles?: Record<string, string>;
}

const CANDIDATE_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.5-flash",
  "gemini-3.7-flash",
  "gemini-3.8-flash",
  "gemini-3.6-flash",
];

/** Retry fetch up to maxRetries times on 503 errors */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 3,
  delayMs = 1200
): Promise<Response> {
  let lastRes: Response | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    lastRes = await fetch(url, options);
    if (lastRes.status !== 503 || attempt === maxRetries) return lastRes;
    await new Promise((r) => setTimeout(r, delayMs * (attempt + 1)));
  }
  return lastRes!;
}

export async function createGeminiStream({
  prompt,
  framework = "nextjs",
  history = [],
  currentFiles = {},
}: StreamGenerationOptions): Promise<ReadableStream<Uint8Array>> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured in environment variables");
  }

  const apiUrl =
    process.env.GEMINI_API_URL ||
    "https://generativelanguage.googleapis.com/v1beta/openai";
  const endpoint = `${apiUrl}/chat/completions`;

  // Build messages:
  // - If /api/agent already injected a system prompt into history → use it as-is
  // - If called directly (e.g. /api/generate) with no system prompt → inject fallback
  const hasSystemInHistory = history.some((m) => m.role === "system");

  const messages: ChatMessagePayload[] = hasSystemInHistory
    ? [
        // System prompt is already first in history from /api/agent
        ...history.slice(-8),
        { role: "user", content: prompt },
      ]
    : [
        // Fallback: inject framework-specific system prompt
        { role: "system", content: getSystemPrompt(framework, "none", "none", "build") },
        ...history.filter((m) => m.role !== "system").slice(-6),
        { role: "user", content: prompt },
      ];

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
  const decoder = new TextDecoder();

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
                // Partial JSON chunk, skip
              }
            }
          }
        }

        // Flush remaining buffer
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
