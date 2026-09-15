/**
 * Dual-Provider AI Streaming Client: Google Gemini + Groq Cloud Fallback
 *
 * Capabilities:
 *  - Primary: Google Gemini (gemini-3.6-flash, gemini-3.7-flash, gemini-flash-latest, gemini-3.5-flash)
 *  - Ultra-Fast Fallback: Groq Cloud
 *      - Text / Coder / Bengali: openai/gpt-oss-120b (120B reasoning model, 1000 requests/day, ~450 tokens/s)
 *      - Lightweight Text: openai/gpt-oss-20b (20B reasoning model)
 *      - Vision / Multimodal: qwen/qwen3.8-27b, qwen/qwen3.6-27b
 *  - Seamless failover: Automatic switch on 429 (Rate limit), 503 (Capacity), or timeout
 *  - BUG6 fix: System prompt always at position[0], never dropped by sliding window
 *  - BUG8 fix: TextDecoder final flush after read loop to preserve UTF-8 multi-byte integrity
 *  - ISSUE15 fix: Per-attempt AbortController timeout (45s)
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

interface AIProviderTarget {
  provider: "gemini" | "groq";
  model: string;
  endpoint: string;
  apiKey: string;
  supportsVision: boolean;
}

const GEMINI_MODELS = [
  "gemini-3.6-flash",
  "gemini-flash-latest",
  "gemini-3.7-flash",
];

const GROQ_TEXT_MODELS = [
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
];

const GROQ_VISION_MODELS = [
  "qwen/qwen3.8-27b",
  "qwen/qwen3.6-27b",
];

/** Instant failover on error or capacity limits, with per-attempt timeout */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 0,
  delayMs = 200,
  timeoutMs = 15000
): Promise<Response> {
  let lastRes: Response | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
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
  const userContent: string | MultimodalPart[] = image
    ? [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: image } },
      ]
    : prompt;

  const systemMessage = history.find((m) => m.role === "system");
  const conversationTurns = history.filter((m) => m.role !== "system");

  if (systemMessage) {
    return [
      systemMessage,
      ...conversationTurns.slice(-7),
      { role: "user", content: userContent },
    ];
  }

  return [
    { role: "system", content: getSystemPrompt(framework, "none", "none", "build") },
    ...conversationTurns.slice(-6),
    { role: "user", content: userContent },
  ];
}

/** Flatten multimodal parts into pure string content for text-only LLMs like openai/gpt-oss-120b */
function sanitizeForTextOnly(messages: ChatMessagePayload[]): Array<{ role: string; content: string }> {
  return messages.map((m) => {
    if (typeof m.content === "string") {
      return { role: m.role, content: m.content };
    }
    if (Array.isArray(m.content)) {
      const text = m.content
        .filter((part): part is { type: "text"; text: string } => part.type === "text")
        .map((part) => part.text)
        .join("\n");
      return { role: m.role, content: text };
    }
    return { role: m.role, content: String(m.content || "") };
  });
}

export async function createGeminiStream({
  prompt,
  image,
  framework = "nextjs",
  history = [],
}: StreamGenerationOptions): Promise<ReadableStream<Uint8Array>> {
  // 1. Resolve Provider Credentials
  const rawGeminiKey = process.env.GEMINI_API_KEY || "";
  const geminiApiKey = rawGeminiKey.trim().replace(/^['"]|['"]$/g, "");
  const rawGeminiUrl =
    process.env.GEMINI_API_URL || "https://generativelanguage.googleapis.com/v1beta/openai";
  const geminiApiUrl = rawGeminiUrl.trim().replace(/^['"]|['"]$/g, "").replace(/\/+$/, "");

  const rawGroqKey = process.env.GROQ_API_KEY || "";
  const groqApiKey = rawGroqKey.trim().replace(/^['"]|['"]$/g, "");
  const rawGroqUrl = process.env.GROQ_API_URL || "https://api.groq.com/openai/v1";
  const groqApiUrl = rawGroqUrl.trim().replace(/^['"]|['"]$/g, "").replace(/\/+$/, "");

  if (!geminiApiKey && !groqApiKey) {
    throw new Error("Neither GEMINI_API_KEY nor GROQ_API_KEY is configured in environment variables");
  }

  const hasImage = Boolean(image && typeof image === "string" && image.startsWith("data:image/"));
  const rawMessages = buildMessages(history, prompt, framework, image);

  // 2. Build Ordered Fallback Targets
  const targets: AIProviderTarget[] = [];

  // Primary: Gemini models (all support vision & text)
  if (geminiApiKey) {
    for (const model of GEMINI_MODELS) {
      targets.push({
        provider: "gemini",
        model,
        endpoint: `${geminiApiUrl}/chat/completions`,
        apiKey: geminiApiKey,
        supportsVision: true,
      });
    }
  }

  // Fallback: Groq models
  if (groqApiKey) {
    if (hasImage) {
      // For images: use Groq Vision models (Qwen)
      for (const model of GROQ_VISION_MODELS) {
        targets.push({
          provider: "groq",
          model,
          endpoint: `${groqApiUrl}/chat/completions`,
          apiKey: groqApiKey,
          supportsVision: true,
        });
      }
    } else {
      // For text/code/edits: use openai/gpt-oss-120b (frontier 120B reasoning model), then 20B, then Qwen
      for (const model of GROQ_TEXT_MODELS) {
        targets.push({
          provider: "groq",
          model,
          endpoint: `${groqApiUrl}/chat/completions`,
          apiKey: groqApiKey,
          supportsVision: false,
        });
      }
      for (const model of GROQ_VISION_MODELS) {
        targets.push({
          provider: "groq",
          model,
          endpoint: `${groqApiUrl}/chat/completions`,
          apiKey: groqApiKey,
          supportsVision: true,
        });
      }
    }
  }

  let response: Response | null = null;
  let activeTarget: AIProviderTarget | null = null;
  let lastError = "";

  // 3. Sequential Attempt with Automatic Failover
  for (const target of targets) {
    try {
      const payloadMessages =
        target.supportsVision
          ? rawMessages
          : sanitizeForTextOnly(rawMessages);

      const requestBody: Record<string, any> = {
        model: target.model,
        messages: payloadMessages,
        temperature: 0.3,
        stream: true,
      };

      const res = await fetchWithRetry(target.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${target.apiKey}`,
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        },
        body: JSON.stringify(requestBody),
      });

      if (res.ok && res.body) {
        console.log(`[AI Stream] Active Provider: [${target.provider}] — Model: [${target.model}]`);
        response = res;
        activeTarget = target;
        break;
      } else {
        const errText = await res.text().catch(() => "");
        lastError = `[${target.provider}:${target.model}] (${res.status}): ${errText.slice(0, 200)}`;
        console.warn(`[AI Stream] ${lastError} — switching to next candidate...`);
      }
    } catch (err: any) {
      lastError = `[${target.provider}:${target.model}] fetch failed: ${err?.message || err}`;
      console.warn(`[AI Stream] ${lastError} — switching to next candidate...`);
    }
  }

  if (!response || !response.body || !activeTarget) {
    throw new Error(`All AI providers failed. Last error: ${lastError}`);
  }

  // 4. Stream Transformer with UTF-8 Multi-byte Protection
  const encoder = new TextEncoder();
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
                // Partial chunk — skip
              }
            }
          }
        }

        // Flush remaining multi-byte characters at stream boundary
        const flushed = decoder.decode();
        if (flushed) buffer += flushed;

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

// Backwards-compatible alias
export const createAIStream = createGeminiStream;
