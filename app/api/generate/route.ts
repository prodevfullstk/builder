import { NextRequest } from 'next/server';
import { createGeminiStream } from '@/lib/ai/gemini-stream';

export const runtime = 'edge';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { prompt, framework, history, currentFiles } = body;

    if (!prompt || typeof prompt !== 'string') {
      return new Response(JSON.stringify({ error: 'Prompt is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const stream = await createGeminiStream({
      prompt,
      framework: framework || 'nextjs',
      history: history || [],
      currentFiles: currentFiles || {},
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error: any) {
    console.error('API /api/generate error:', error);
    return new Response(
      JSON.stringify({ error: error?.message || 'Failed to generate code' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
