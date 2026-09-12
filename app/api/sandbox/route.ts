import { NextRequest, NextResponse } from 'next/server';
import { Sandbox } from '@vercel/sandbox';
import { generateInstantPreviewHtml } from '@/lib/preview/instant-preview-html';
import { authenticateRequest } from '@/lib/auth/server-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export type SandboxLifecycleStatus =
  | 'created'
  | 'installing'
  | 'building'
  | 'build_failed'
  | 'starting'
  | 'runtime_ready'
  | 'runtime_failed'
  | 'stopped';

export interface SandboxResponse {
  success: boolean;
  status: SandboxLifecycleStatus;
  mode: 'visual_preview' | 'framework_runtime';
  previewUrl?: string;
  sandboxName?: string;
  isReady?: boolean;
  diagnostics?: string[];
  skippedChecks?: Array<{ name: string; reason: string }>;
  error?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const {
      action = 'start',
      projectId,
      files = {},
      framework = 'nextjs',
      mode = 'visual_preview', // 'visual_preview' | 'framework_runtime'
    } = body;

    // 1. Strict Project ID Validation (No "default" or arbitrary fallback)
    if (!projectId || typeof projectId !== 'string' || !projectId.trim() || projectId === 'default') {
      return NextResponse.json(
        {
          success: false,
          error: "Validation Error: 'projectId' is required. Implicit fallback to 'default' project is forbidden.",
        },
        { status: 400 }
      );
    }

    // 2. Authentication Check
    const authResult = await authenticateRequest(req, { allowDemo: true });
    if (authResult.error) {
      return NextResponse.json(
        { success: false, error: authResult.error },
        { status: authResult.status }
      );
    }

    const safeId = projectId
      .replace(/[^a-zA-Z0-9-]/g, '')
      .slice(0, 24)
      .toLowerCase();
    const sandboxName = `sbx-${safeId}`;

    if (action === 'stop') {
      try {
        const sandbox = await Sandbox.get({ name: sandboxName });
        await sandbox.stop();
        return NextResponse.json({
          success: true,
          status: 'stopped',
          mode,
        });
      } catch {
        return NextResponse.json({
          success: true,
          status: 'stopped',
          mode,
        });
      }
    }

    // 3. Get or create persistent Vercel Sandbox with port 3000 exposed
    const sandbox = await Sandbox.getOrCreate({
      name: sandboxName,
      ports: [3000],
      timeout: 20 * 60 * 1000, // 20 min TTL
    });

    const previewUrl = sandbox.domain(3000);

    // ── MODE A: VISUAL PREVIEW (Static HTML bundle) ──
    if (mode === 'visual_preview') {
      const filesToWrite: { path: string; content: string }[] = [];
      const hasIndexHtml = Object.keys(files).some((f) => f.toLowerCase() === 'index.html' || f.endsWith('/index.html'));
      const hasTsxOrJsx = Object.keys(files).some((f) => /\.(tsx|jsx|ts)$/i.test(f));
      const rawIndexHtml = String(Object.entries(files).find(([f]) => f.toLowerCase() === 'index.html' || f.endsWith('/index.html'))?.[1] || '');
      const indexHasTsx = /<script[^>]*src=["'][^"']*\.(tsx|jsx|ts)["']/i.test(rawIndexHtml);

      const shouldCompileIndex = hasTsxOrJsx || indexHasTsx || !hasIndexHtml;

      if (shouldCompileIndex && Object.keys(files).length > 0) {
        const generatedHtml = generateInstantPreviewHtml(files);
        filesToWrite.push({
          path: '/vercel/app/index.html',
          content: generatedHtml,
        });
      }

      for (const [filePath, content] of Object.entries(files)) {
        if (typeof content !== 'string') continue;
        const cleanPath = filePath.startsWith('/') ? filePath.slice(1) : filePath;
        if (shouldCompileIndex && (cleanPath.toLowerCase() === 'index.html' || cleanPath.endsWith('/index.html'))) {
          filesToWrite.push({
            path: `/vercel/app/index.source.html`,
            content,
          });
          continue;
        }
        filesToWrite.push({
          path: `/vercel/app/${cleanPath}`,
          content,
        });
      }

      const serverScript = `
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.ts': 'text/javascript; charset=utf-8',
  '.tsx': 'text/javascript; charset=utf-8',
  '.jsx': 'text/javascript; charset=utf-8',
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
  if (reqPath === '/favicon.ico') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (reqPath === '/') reqPath = '/index.html';
  let filePath = path.join('/vercel/app', reqPath);

  if (!fs.existsSync(filePath)) {
    const srcCandidate = path.join('/vercel/app/src', reqPath);
    if (fs.existsSync(srcCandidate)) {
      filePath = srcCandidate;
    } else {
      const publicCandidate = path.join('/vercel/app/public', reqPath);
      if (fs.existsSync(publicCandidate)) {
        filePath = publicCandidate;
      }
    }
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
    res.end(fs.readFileSync(filePath));
  } else {
    const indexPath = '/vercel/app/index.html';
    if (fs.existsSync(indexPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(indexPath));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

server.listen(3000, '0.0.0.0', () => {
  console.log('Visual preview server active on port 3000');
});
`;

      filesToWrite.push({
        path: '/vercel/server.mjs',
        content: serverScript,
      });

      await sandbox.writeFiles(filesToWrite);

      await sandbox.runCommand({
        cmd: 'node',
        args: ['/vercel/server.mjs'],
        detached: true,
      });

      // Poll preview URL
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

      // Explicitly label as visual_preview, NOT framework_runtime!
      return NextResponse.json({
        success: true,
        previewUrl,
        sandboxName,
        status: isReady ? 'runtime_ready' : 'starting',
        mode: 'visual_preview',
        isReady,
        skippedChecks: [
          { name: 'framework_build', reason: 'Visual preview mode runs pre-compiled instant DOM bundle without node_modules build' },
          { name: 'server_components_runtime', reason: 'Instant preview does not execute Node.js SSR/Server Actions runtime' },
          { name: 'api_route_execution', reason: 'Vercel Sandbox visual preview serves static assets; backend API routes require framework runtime' },
        ],
      });
    }

    // ── MODE B: FULL FRAMEWORK RUNTIME ──
    const filesToWrite: { path: string; content: string }[] = [];
    for (const [filePath, content] of Object.entries(files)) {
      if (typeof content !== 'string') continue;
      const cleanPath = filePath.startsWith('/') ? filePath.slice(1) : filePath;
      filesToWrite.push({
        path: `/vercel/app/${cleanPath}`,
        content,
      });
    }

    await sandbox.writeFiles(filesToWrite);

    // 1. Attempt Package Installation
    const installResult = await sandbox.runCommand({
      cmd: 'npm',
      args: ['install', '--prefix', '/vercel/app', '--prefer-offline'],
    });

    if (installResult.exitCode !== 0) {
      return NextResponse.json({
        success: false,
        status: 'build_failed',
        mode: 'framework_runtime',
        error: `Dependency installation failed: ${installResult.stderr || installResult.stdout}`,
      });
    }

    // 2. Build Verification Check
    const buildResult = await sandbox.runCommand({
      cmd: 'npm',
      args: ['run', 'build', '--prefix', '/vercel/app'],
    });

    if (buildResult.exitCode !== 0) {
      return NextResponse.json({
        success: false,
        status: 'build_failed',
        mode: 'framework_runtime',
        error: `Framework build failed: ${buildResult.stderr || buildResult.stdout}`,
      });
    }

    // 3. Start Framework Runtime
    await sandbox.runCommand({
      cmd: 'npm',
      args: ['start', '--prefix', '/vercel/app', '--', '-p', '3000'],
      detached: true,
    });

    // 4. HTTP Smoke Test
    let isSmokeReady = false;
    for (let i = 0; i < 15; i++) {
      try {
        const ping = await fetch(previewUrl, { method: 'GET' });
        if (ping.ok || ping.status === 200 || ping.status === 304) {
          isSmokeReady = true;
          break;
        }
      } catch {
        // waiting for port binding
      }
      await new Promise((r) => setTimeout(r, 800));
    }

    return NextResponse.json({
      success: isSmokeReady,
      previewUrl,
      sandboxName,
      status: isSmokeReady ? 'runtime_ready' : 'runtime_failed',
      mode: 'framework_runtime',
      isReady: isSmokeReady,
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
    const projectId = url.searchParams.get('projectId');

    if (!projectId || !projectId.trim() || projectId === 'default') {
      return NextResponse.json(
        { success: false, error: "Validation Error: 'projectId' parameter is required to stop sandbox." },
        { status: 400 }
      );
    }

    const authResult = await authenticateRequest(req, { allowDemo: true });
    if (authResult.error) {
      return NextResponse.json(
        { success: false, error: authResult.error },
        { status: authResult.status }
      );
    }

    const safeId = projectId
      .replace(/[^a-zA-Z0-9-]/g, '')
      .slice(0, 24)
      .toLowerCase();
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
