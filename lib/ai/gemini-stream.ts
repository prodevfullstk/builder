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

export async function createGeminiStream({
  prompt,
  framework = 'nextjs',
  history = [],
  currentFiles = {},
}: StreamGenerationOptions): Promise<ReadableStream<Uint8Array>> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in environment variables');
  }

  const apiUrl = process.env.GEMINI_API_URL || 'https://generativelanguage.googleapis.com/v1beta/openai';
  const endpoint = `${apiUrl}/chat/completions`;

  const systemPrompt = getSystemPrompt(framework);

  // If there are existing files, provide a summary of current project state for follow-up edits
  let userContent = prompt;
  if (Object.keys(currentFiles).length > 0) {
    const fileSummary = Object.entries(currentFiles)
      .slice(0, 10)
      .map(([path, content]) => `\`\`\`${path}\n${content.slice(0, 1500)}\n\`\`\``)
      .join('\n\n');
    userContent = `CURRENT PROJECT FILES:\n${fileSummary}\n\nUSER REQUEST:\n${prompt}\n\nPlease output the updated complete files.`;
  }

  const messages: ChatMessagePayload[] = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-6), // keep last 6 conversational messages for context
    { role: 'user', content: userContent },
  ];

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gemini-3.6-flash',
      messages,
      temperature: 0.2,
      stream: true,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errorText}`);
  }

  if (!response.body) {
    throw new Error('Response body is null');
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  // Create a transform stream to parse SSE and pipe plain text chunks to client
  return new ReadableStream({
    async start(controller) {
      const reader = response.body!.getReader();
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
                // Partial JSON chunk, ignore
              }
            }
          }
        }
      } catch (err) {
        controller.error(err);
      } finally {
        controller.close();
      }
    },
  });
}
