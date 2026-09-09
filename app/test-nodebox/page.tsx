'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import type { Framework } from '@/components/sandbox/nodebox-preview';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { InstantPreview } from '@/components/preview/instant-preview';
import { Zap, Box } from 'lucide-react';

const NodeboxPreview = dynamic(
  () => import('@/components/sandbox/nodebox-preview').then((mod) => mod.NodeboxPreview),
  { ssr: false }
);

// Test templates
const templates: Record<string, Record<string, string>> = {
  instant: {
    'app/page.tsx': `'use client';
import React, { useState } from 'react';
import { Sparkles, ArrowRight, Zap, CheckCircle2 } from 'lucide-react';

export default function Home() {
  const [count, setCount] = useState(0);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6 text-center font-sans">
      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-medium mb-6">
        <Sparkles className="w-3.5 h-3.5" />
        Instant Preview Engine
      </div>
      <h1 className="text-4xl sm:text-6xl font-bold tracking-tight mb-4 bg-gradient-to-r from-blue-400 via-indigo-300 to-purple-400 bg-clip-text text-transparent">
        Live React Preview in 500ms
      </h1>
      <p className="text-slate-400 max-w-lg mb-8 text-base">
        Zero service workers, zero timeouts. Compiles React 19, Tailwind CSS, and Lucide icons instantly in your browser!
      </p>
      <div className="flex items-center gap-4">
        <button
          onClick={() => setCount(c => c + 1)}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium shadow-lg shadow-blue-500/20 transition-all cursor-pointer"
        >
          <Zap className="w-4 h-4" />
          Clicked {count} times
        </button>
        <div className="inline-flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
          <CheckCircle2 className="w-4 h-4" />
          100% Client-side
        </div>
      </div>
    </div>
  );
}`,
  },
  vite: {
    'package.json': JSON.stringify({
      name: 'vite-react-test',
      version: '1.0.0',
      type: 'module',
      scripts: {
        dev: 'vite --port 5173 --host 0.0.0.0'
      },
      dependencies: {
        'react': '^18.2.0',
        'react-dom': '^18.2.0'
      },
      devDependencies: {
        '@vitejs/plugin-react': '^4.2.0',
        'vite': '^5.0.0'
      }
    }, null, 2),
    'index.html': `<!DOCTYPE html>
<html>
  <head>
    <title>Vite App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>`,
    'src/main.jsx': `import React from 'react';
import ReactDOM from 'react-dom/client';

function App() {
  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui', color: '#fff', background: '#09090b', minHeight: '100vh' }}>
      <h1 style={{ fontSize: '2.5rem', color: '#60a5fa', marginBottom: '1rem' }}>
        ⚡ Vite + React in Nodebox
      </h1>
      <p style={{ color: '#a1a1aa' }}>Fast in-browser bundler preview via Nodebox!</p>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);`,
    'vite.config.js': `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: '0.0.0.0'
  }
});`
  },
  nextjs: {
    'package.json': JSON.stringify({
      name: 'nextjs-test',
      version: '1.0.0',
      scripts: {
        dev: 'next dev --port 3000 --hostname 0.0.0.0'
      },
      dependencies: {
        'next': '^14.0.0',
        'react': '^18.2.0',
        'react-dom': '^18.2.0'
      }
    }, null, 2),
    'app/page.tsx': `export default function Home() {
  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui', color: '#fff', background: '#09090b', minHeight: '100vh' }}>
      <h1 style={{ fontSize: '2.5rem', color: '#34d399', marginBottom: '1rem' }}>
        ✅ Next.js in Nodebox!
      </h1>
      <p style={{ color: '#a1a1aa' }}>Running full Next.js App Router in browser</p>
    </div>
  );
}`,
    'app/layout.tsx': `export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}`
  },
  astro: {
    'package.json': JSON.stringify({
      name: 'astro-test',
      version: '1.0.0',
      scripts: { dev: 'astro dev --port 4321 --host' },
      dependencies: { 'astro': '^4.0.0' }
    }, null, 2),
    'src/pages/index.astro': `---
---
<html lang="en">
  <body style="padding: 2rem; font-family: system-ui; color: #fff; background: #09090b;">
    <h1 style="color: #f472b6;">🚀 Astro in Nodebox</h1>
  </body>
</html>`
  },
  node: {
    'index.js': `const http = require('http');
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<h1>Node.js HTTP Server in Browser</h1>');
});
server.listen(3000, '0.0.0.0');`
  }
};

export default function TestNodeboxPage() {
  const [selectedFramework, setSelectedFramework] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('idle');
  const [error, setError] = useState<string | null>(null);
  const [previewEngine, setPreviewEngine] = useState<'instant' | 'nodebox'>('instant');

  const handleTest = (fw: string) => {
    setSelectedFramework(fw);
    setStatus('initializing');
    setError(null);
    setPreviewEngine(fw === 'instant' ? 'instant' : 'nodebox');
  };

  const handleReset = () => {
    setSelectedFramework(null);
    setStatus('idle');
    setError(null);
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-6">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Preview Engines & Sandbox Test Suite</h1>
          <p className="text-zinc-400 text-sm">
            Test the Dual Preview Architecture: ⚡ Instant Preview (Fast) & 📦 Nodebox Runtime
          </p>
        </div>

        {!selectedFramework ? (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Instant Preview Card */}
            <Card className="bg-blue-950/20 border-blue-800/50 hover:border-blue-500 transition-colors">
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-blue-300">
                  ⚡ Instant Preview
                  <Badge variant="default" className="bg-blue-600">Recommended</Badge>
                </CardTitle>
                <CardDescription>
                  In-browser React + Vite + Tailwind compiler. 500ms startup!
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button onClick={() => handleTest('instant')} className="w-full bg-blue-600 hover:bg-blue-500">
                  Test Instant Preview
                </Button>
              </CardContent>
            </Card>

            {/* Vite Test */}
            <Card className="bg-zinc-900 border-zinc-800 hover:border-zinc-700 transition-colors">
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  Vite + React
                  <Badge variant="outline">Nodebox</Badge>
                </CardTitle>
                <CardDescription>
                  Vite 5 dev server in Nodebox runtime
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button onClick={() => handleTest('vite')} className="w-full" variant="outline">
                  Test Vite
                </Button>
              </CardContent>
            </Card>

            {/* Next.js Test */}
            <Card className="bg-zinc-900 border-zinc-800 hover:border-zinc-700 transition-colors">
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  Next.js App
                  <Badge variant="outline">Nodebox</Badge>
                </CardTitle>
                <CardDescription>
                  Next.js dev server in Nodebox
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button onClick={() => handleTest('nextjs')} className="w-full" variant="outline">
                  Test Next.js
                </Button>
              </CardContent>
            </Card>

            {/* Astro Test */}
            <Card className="bg-zinc-900 border-zinc-800 hover:border-zinc-700 transition-colors">
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  Astro 4
                  <Badge variant="outline">Nodebox</Badge>
                </CardTitle>
                <CardDescription>
                  Astro dev server in Nodebox
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button onClick={() => handleTest('astro')} className="w-full" variant="outline">
                  Test Astro
                </Button>
              </CardContent>
            </Card>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between bg-zinc-900 p-3 rounded-lg border border-zinc-800">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-bold">Testing {selectedFramework.toUpperCase()}</h2>
                <div className="flex items-center gap-1 bg-zinc-950 p-0.5 rounded border border-zinc-800 text-xs">
                  <button
                    onClick={() => setPreviewEngine('instant')}
                    className={`flex items-center gap-1 px-2 py-1 rounded transition-colors ${
                      previewEngine === 'instant' ? 'bg-blue-600 text-white' : 'text-zinc-400'
                    }`}
                  >
                    <Zap className="w-3 h-3 text-amber-300" />
                    Instant Preview
                  </button>
                  <button
                    onClick={() => setPreviewEngine('nodebox')}
                    className={`flex items-center gap-1 px-2 py-1 rounded transition-colors ${
                      previewEngine === 'nodebox' ? 'bg-zinc-800 text-white' : 'text-zinc-500'
                    }`}
                  >
                    <Box className="w-3 h-3" />
                    Nodebox Runtime
                  </button>
                </div>
              </div>
              <Button onClick={handleReset} variant="outline" size="sm">
                ← Back to Tests
              </Button>
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-xs text-red-400 font-mono">
                {error}
              </div>
            )}

            <div className="border border-zinc-800 rounded-lg overflow-hidden h-[600px]">
              {previewEngine === 'instant' ? (
                <InstantPreview files={templates[selectedFramework] || templates.instant} />
              ) : (
                <NodeboxPreview
                  files={templates[selectedFramework] || {}}
                  framework={selectedFramework as Framework}
                  onStatusChange={(s: string) => setStatus(s)}
                  onError={(err: string) => setError(err)}
                  onReady={() => setStatus('ready')}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
