import { NextRequest } from 'next/server';
import { createGeminiStream } from '@/lib/ai/gemini-stream';

export const maxDuration = 30;
export const dynamic = 'force-dynamic';

const CHAT_SYSTEM_PROMPT = `You are Opendork, a friendly AI assistant for a web app builder.
Answer the user conversationally and helpfully. Keep responses short and clear.
Do NOT generate code files or use filename= code block format.
If the user wants to build something, encourage them to describe it fully so you can generate it.`;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { message, history } = body;

    if (!message || typeof message !== 'string') {
      return new Response(JSON.stringify({ error: 'Message is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const stream = await createGeminiStream({
      prompt: message,
      framework: 'nextjs',
      history: [
        { role: 'system', content: CHAT_SYSTEM_PROMPT },
        ...(history || []).slice(-6),
      ],
      currentFiles: {},
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Content-Type-Options': 'nosniff',
        'Connection': 'keep-alive',
      },
    });
  } catch (error: any) {
    console.error('API /api/chat error:', error);
    return new Response(
      JSON.stringify({ error: error?.message || 'Chat failed' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
