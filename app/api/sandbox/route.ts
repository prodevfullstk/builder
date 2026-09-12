import { NextRequest, NextResponse } from 'next/server';
import { Sandbox } from '@vercel/sandbox';
import { generateInstantPreviewHtml } from '@/lib/preview/instant-preview-html';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action = 'start', projectId = 'default', files = {}, framework = 'nextjs' } = body;

    const safeId = (projectId || 'default')
      .replace(/[^a-zA-Z0-9-]/g, '')
      .slice(0, 24)
      .toLowerCase() || 'default';
    const sandboxName = `sbx-${safeId}`;

    if (action === 'stop') {
      try {
        const sandbox = await Sandbox.get({ name: sandboxName });
        await sandbox.stop();
        return NextResponse.json({ success: true, status: 'stopped' });
      } catch {
        return NextResponse.json({ success: true, status: 'already_stopped' });
      }
    }

    // Default: 'start' / 'sync'
    // 1. Get or create persistent Vercel Sandbox with port 3000 exposed
    const sandbox = await Sandbox.getOrCreate({
      name: sandboxName,
      ports: [3000],
      timeout: 20 * 60 * 1000, // 20 min TTL
    });

    const previewUrl = sandbox.domain(3000);

    // 2. Prepare files to write inside the microVM
    const filesToWrite: { path: string; content: string }[] = [];
    const hasIndexHtml = Object.keys(files).some((f) => f.toLowerCase() === 'index.html' || f.endsWith('/index.html'));
    const hasPackageJson = Object.keys(files).some((f) => f.toLowerCase() === 'package.json');

    // If no static index.html is in project files, compile and provide preview bundle HTML for /vercel/app/index.html
    if (!hasIndexHtml && Object.keys(files).length > 0) {
      const generatedHtml = generateInstantPreviewHtml(files);
      filesToWrite.push({
        path: '/vercel/app/index.html',
        content: generatedHtml,
      });
    }

    // Write all project files to /vercel/app
    for (const [filePath, content] of Object.entries(files)) {
      if (typeof content !== 'string') continue;
      const cleanPath = filePath.startsWith('/') ? filePath.slice(1) : filePath;
      filesToWrite.push({
        path: `/vercel/app/${cleanPath}`,
        content,
      });
    }

    // 3. Write intelligent runner server
    const serverScript = `
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  // CORS & Iframe embedding headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('X-Frame-Options', 'ALLOWALL');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  let reqPath = req.url.split('?')[0];
  if (reqPath === '/') reqPath = '/index.html';
  const filePath = path.join('/vercel/app', reqPath);

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
    res.end(fs.readFileSync(filePath));
  } else {
    // Single Page Application fallback
    const indexPath = '/vercel/app/index.html';
    if (fs.existsSync(indexPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(indexPath));
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }
  }
});

server.listen(3000, '0.0.0.0', () => {
  console.log('App server active on port 3000');
});
`;

    filesToWrite.push({
      path: '/vercel/server.mjs',
      content: serverScript,
    });

    // Write files to sandbox
    await sandbox.writeFiles(filesToWrite);

    // 4. Start server in detached mode
    await sandbox.runCommand({
      cmd: 'node',
      args: ['/vercel/server.mjs'],
      detached: true,
    });

    // 5. Poll preview URL to ensure server is ready
    let isReady = false;
    for (let i = 0; i < 10; i++) {
      try {
        const ping = await fetch(previewUrl, { method: 'GET' });
        if (ping.ok || ping.status === 200 || ping.status === 304) {
          isReady = true;
          break;
        }
      } catch {
        // waiting for port binding
      }
      await new Promise((r) => setTimeout(r, 600));
    }

    return NextResponse.json({
      success: true,
      previewUrl,
      sandboxName,
      status: 'ready',
      isReady,
    });
  } catch (error: any) {
    console.error('Vercel Sandbox API Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error?.message || 'Failed to manage Vercel Sandbox',
      },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const projectId = url.searchParams.get('projectId') || 'default';
    const safeId = projectId
      .replace(/[^a-zA-Z0-9-]/g, '')
      .slice(0, 24)
      .toLowerCase() || 'default';
    const sandboxName = `sbx-${safeId}`;

    try {
      const sandbox = await Sandbox.get({ name: sandboxName });
      await sandbox.stop();
      return NextResponse.json({ success: true, status: 'stopped' });
    } catch {
      return NextResponse.json({ success: true, status: 'already_stopped' });
    }
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to stop sandbox' },
      { status: 500 }
    );
  }
}
