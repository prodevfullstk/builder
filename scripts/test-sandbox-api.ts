import fs from 'fs';
import path from 'path';

// Read and inject .env.local
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const idx = trimmed.indexOf('=');
      const key = trimmed.slice(0, idx).trim();
      let val = trimmed.slice(idx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

async function testApi() {
  console.log('Testing Vercel Sandbox API handler...');

  // Dynamically import route handler
  const { POST, DELETE } = await import('../app/api/sandbox/route');
  const { NextRequest } = await import('next/server');

  const testPayload = {
    action: 'start',
    projectId: 'test-audit-p1',
    framework: 'nextjs',
    files: {
      'index.html': `<!DOCTYPE html><html><head><title>Vite App</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>`,
      'src/App.tsx': `import React from 'react';
import { Navbar } from './components/Navbar';
import { Hero } from './components/Hero';
import { useLandingState } from './hooks/useLandingState';
export default function App() {
  const { toastMessage } = useLandingState();
  return <div><h1>🚀 Opendork Live App</h1><Navbar /><Hero /><p>{toastMessage}</p></div>;
}`,
      'src/components/Navbar.tsx': `import React from 'react'; export function Navbar() { return <nav>Navbar Component</nav>; }`,
      'src/components/Hero.tsx': `import React from 'react'; export function Hero() { return <section>Hero Component</section>; }`,
      'src/hooks/useLandingState.ts': `export function useLandingState() { return { toastMessage: 'Landing State Active' }; }`,
      'src/main.tsx': `import React from 'react'; import ReactDOM from 'react-dom/client'; import App from './App'; ReactDOM.createRoot(document.getElementById('root')).render(<App />);`,
    },
  };

  const req = new NextRequest('http://localhost:3000/api/sandbox', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(testPayload),
  });

  console.log('Dispatching POST /api/sandbox...');
  const res = await POST(req);
  console.log('Status code:', res.status);
  const data = await res.json();
  console.log('Response payload:', JSON.stringify(data, null, 2));

  if (!data.success || !data.previewUrl) {
    throw new Error('API did not return previewUrl');
  }

  console.log('Pinging previewUrl:', data.previewUrl);
  const ping = await fetch(data.previewUrl);
  console.log('Ping status:', ping.status);
  const text = await ping.text();
  console.log('Ping body excerpt:', text.slice(0, 100));

  console.log('Testing DELETE /api/sandbox...');
  const deleteReq = new NextRequest('http://localhost:3000/api/sandbox?projectId=test-audit-p1', {
    method: 'DELETE',
  });
  const delRes = await DELETE(deleteReq);
  const delData = await delRes.json();
  console.log('DELETE response:', delData);

  console.log('✅ End-to-end API test PASSED successfully!');
}

testApi().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
