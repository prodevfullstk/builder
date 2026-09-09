import { getSystemPrompt } from './prompt-templates';

export interface ChatMessagePayload {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface StreamGenerationOptions {
  prompt: string;
  framework?: string;
  history?: ChatMessagePayload[];
  currentFiles?: Record<string, string>;
}

const CANDIDATE_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
];

export async function createGeminiStream({
  prompt,
  framework = 'nextjs',
  history = [],
  currentFiles = {},
}: StreamGenerationOptions): Promise<ReadableStream<Uint8Array>> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in Vercel environment variables');
  }

  const apiUrl = process.env.GEMINI_API_URL || 'https://generativelanguage.googleapis.com/v1beta/openai';
  const endpoint = `${apiUrl}/chat/completions`;

  const systemPrompt = getSystemPrompt(framework);

  // If there are existing files, provide concise summary of project structure
  let userContent = prompt;
  if (Object.keys(currentFiles).length > 0) {
    const fileSummary = Object.entries(currentFiles)
      .slice(0, 8)
      .map(([path, content]) => `\`\`\`${path}\n${content.slice(0, 1000)}\n\`\`\``)
      .join('\n\n');
    userContent = `CURRENT PROJECT FILES:\n${fileSummary}\n\nUSER REQUEST:\n${prompt}\n\nPlease output the updated complete files using \`\`\`filename=... format.`;
  }

  const messages: ChatMessagePayload[] = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-4),
    { role: 'user', content: userContent },
  ];

  let response: Response | null = null;
  let lastError = '';

  // Try candidate models in order for maximum reliability
  for (const model of CANDIDATE_MODELS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
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
        response = res;
        break;
      } else {
        const errText = await res.text().catch(() => '');
        lastError = `Model ${model} returned (${res.status}): ${errText}`;
        console.warn(`[AI Stream] ${lastError}, attempting next model...`);
      }
    } catch (err: any) {
      lastError = `Model ${model} fetch failed: ${err?.message || err}`;
      console.warn(`[AI Stream] ${lastError}`);
    }
  }

  if (!response || !response.body) {
    throw new Error(`Failed to initialize AI stream. Last error: ${lastError}`);
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  // Create a transform stream to parse SSE and pipe plain text chunks to client
  return new ReadableStream({
    async start(controller) {
      const reader = response!.body!.getReader();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed === 'data: [DONE]') continue;
            if (trimmed.startsWith('data: ')) {
              try {
                const json = JSON.parse(trimmed.slice(6));
                const content = json.choices?.[0]?.delta?.content;
                if (content) {
                  controller.enqueue(encoder.encode(content));
                }
              } catch {
                // Partial JSON chunk, skip
              }
            }
          }
        }

        if (buffer.trim().startsWith('data: ') && buffer.trim() !== 'data: [DONE]') {
          try {
            const json = JSON.parse(buffer.trim().slice(6));
            const content = json.choices?.[0]?.delta?.content;
            if (content) {
              controller.enqueue(encoder.encode(content));
            }
          } catch {}
        }

        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
}
