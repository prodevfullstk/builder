'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import type { Framework } from '@/components/sandbox/nodebox-preview';

const NodeboxPreview = dynamic(
  () => import('@/components/sandbox/nodebox-preview').then((mod) => mod.NodeboxPreview),
  { ssr: false }
);
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

// Test templates for different frameworks
const templates: Record<Framework, Record<string, string>> = {
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
    <div style={{ padding: '2rem', fontFamily: 'system-ui' }}>
      <h1 style={{ fontSize: '3rem', marginBottom: '1rem' }}>
        ✅ Next.js in Nodebox!
      </h1>
      <p style={{ fontSize: '1.25rem', color: '#666' }}>
        This is running in your browser using Nodebox 🎉
      </p>
      <div style={{ marginTop: '2rem' }}>
        <p>Current time: {new Date().toLocaleTimeString()}</p>
      </div>
    </div>
  );
}`,
    'app/layout.tsx': `export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}`,
    'next.config.js': `/** @type {import('next').NextConfig} */
const nextConfig = {};

module.exports = nextConfig;`
  },
  
  astro: {
    'package.json': JSON.stringify({
      name: 'astro-test',
      version: '1.0.0',
      scripts: {
        dev: 'astro dev --port 4321 --host'
      },
      dependencies: {
        'astro': '^4.0.0'
      }
    }, null, 2),
    'src/pages/index.astro': `---
const currentTime = new Date().toLocaleTimeString();
---

<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width" />
    <title>Astro in Nodebox</title>
  </head>
  <body style="padding: 2rem; font-family: system-ui;">
    <h1 style="font-size: 3rem; margin-bottom: 1rem;">
      ✅ Astro in Nodebox!
    </h1>
    <p style="font-size: 1.25rem; color: #666;">
      This is running in your browser using Nodebox 🎉
    </p>
    <div style="margin-top: 2rem;">
      <p>Built at: {currentTime}</p>
    </div>
  </body>
</html>`,
    'astro.config.mjs': `import { defineConfig } from 'astro/config';

export default defineConfig({});`
  },
  
  vite: {
    'package.json': JSON.stringify({
      name: 'vite-test',
      version: '1.0.0',
      scripts: {
        dev: 'vite --port 5173 --host 0.0.0.0'
      },
      dependencies: {
        'react': '^18.2.0',
        'react-dom': '^18.2.0'
      },
      devDependencies: {
        'vite': '^5.0.0',
        '@vitejs/plugin-react': '^4.0.0',
        '@types/react': '^18.2.0',
        '@types/react-dom': '^18.2.0'
      }
    }, null, 2),
    'index.html': `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Vite + React</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`,
    'src/main.tsx': `import React from 'react';
import ReactDOM from 'react-dom/client';

function App() {
  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui' }}>
      <h1 style={{ fontSize: '3rem', marginBottom: '1rem' }}>
        ✅ Vite + React in Nodebox!
      </h1>
      <p style={{ fontSize: '1.25rem', color: '#666' }}>
        This is running in your browser using Nodebox 🎉
      </p>
      <div style={{ marginTop: '2rem' }}>
        <p>Current time: {new Date().toLocaleTimeString()}</p>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);`,
    'vite.config.ts': `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});`
  },

  node: {
    'package.json': JSON.stringify({
      name: 'node-test',
      version: '1.0.0',
      scripts: {
        dev: 'node index.js'
      }
    }, null, 2),
    'index.js': `const http = require('http');
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<h1>✅ Node.js Server in Nodebox!</h1>');
});
server.listen(3000, () => {
  console.log('Server running on port 3000');
});`
  }
};

export default function TestNodeboxPage() {
  const [selectedFramework, setSelectedFramework] = useState<Framework | null>(null);
  const [status, setStatus] = useState<string>('idle');
  const [error, setError] = useState<string | null>(null);
  
  const handleTest = (framework: Framework) => {
    setSelectedFramework(framework);
    setStatus('starting');
    setError(null);
  };
  
  const handleReset = () => {
    setSelectedFramework(null);
    setStatus('idle');
    setError(null);
  };
  
  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="container mx-auto p-8">
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2">
            Nodebox Test Suite
          </h1>
          <p className="text-zinc-400">
            Test fullstack frameworks running in browser with Nodebox
          </p>
        </div>
        
        {!selectedFramework ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Next.js Test */}
            <Card className="bg-zinc-900 border-zinc-800">
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  Next.js
                  <Badge variant="default">Framework</Badge>
                </CardTitle>
                <CardDescription>
                  Test Next.js 14 dev server with App Router
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button 
                  onClick={() => handleTest('nextjs')}
                  className="w-full"
                >
                  Test Next.js
                </Button>
              </CardContent>
            </Card>
            
            {/* Astro Test */}
            <Card className="bg-zinc-900 border-zinc-800">
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  Astro
                  <Badge variant="secondary">Framework</Badge>
                </CardTitle>
                <CardDescription>
                  Test Astro 4 dev server with static pages
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button 
                  onClick={() => handleTest('astro')}
                  className="w-full"
                  variant="secondary"
                >
                  Test Astro
                </Button>
              </CardContent>
            </Card>
            
            {/* Vite Test */}
            <Card className="bg-zinc-900 border-zinc-800">
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  Vite + React
                  <Badge variant="outline">Bundler</Badge>
                </CardTitle>
                <CardDescription>
                  Test Vite 5 with React (already working)
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button 
                  onClick={() => handleTest('vite')}
                  className="w-full"
                  variant="outline"
                >
                  Test Vite
                </Button>
              </CardContent>
            </Card>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h2 className="text-2xl font-bold">
                  Testing {selectedFramework}
                </h2>
                <Badge variant={
                  status === 'ready' ? 'default' : 
                  status === 'error' ? 'destructive' : 
                  'secondary'
                }>
                  {status}
                </Badge>
              </div>
              <Button onClick={handleReset} variant="outline">
                ← Back to Tests
              </Button>
            </div>
            
            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
                <p className="text-red-400 font-mono text-sm">{error}</p>
              </div>
            )}
            
            <div className="border border-zinc-800 rounded-lg overflow-hidden h-[calc(100vh-16rem)]">
              <NodeboxPreview
                files={templates[selectedFramework]}
                framework={selectedFramework}
                onStatusChange={(newStatus) => setStatus(newStatus)}
                onError={(err) => setError(err)}
                onReady={() => setStatus('ready')}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
