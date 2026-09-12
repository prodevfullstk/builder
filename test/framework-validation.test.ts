import { describe, it } from 'node:test';
import assert from 'node:assert';
import { validateFrameworkContract } from '../lib/validation/framework-validator';

describe('Deterministic Framework Contract Validation', () => {
  it('validates a correct Next.js App Router project contract', () => {
    const nextFiles = {
      'package.json': JSON.stringify({
        name: 'valid-nextjs-app',
        dependencies: {
          next: '^15.0.0',
          react: '^19.0.0',
          'react-dom': '^19.0.0',
        },
      }),
      'next.config.ts': 'export default {};',
      'app/layout.tsx': 'export default function RootLayout({ children }: { children: React.ReactNode }) { return <html><body>{children}</body></html>; }',
      'app/page.tsx': 'export default function Page() { return <div>Home</div>; }',
    };

    const result = validateFrameworkContract('nextjs', nextFiles);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.diagnostics.length, 0);
  });

  it('rejects a Next.js project missing layout and page', () => {
    const brokenNextFiles = {
      'package.json': JSON.stringify({
        name: 'broken-nextjs-app',
        dependencies: {
          next: '^15.0.0',
        },
      }),
      'next.config.js': 'module.exports = {};',
    };

    const result = validateFrameworkContract('nextjs', brokenNextFiles);
    assert.strictEqual(result.valid, false);
    assert.ok(result.diagnostics.some((e) => e.includes('app/') || e.includes('directory')));
  });

  it('rejects an invalid hybrid Next.js project containing Vite config', () => {
    const hybridFiles = {
      'package.json': JSON.stringify({
        name: 'hybrid-app',
        dependencies: {
          next: '^15.0.0',
          react: '^19.0.0',
          'react-dom': '^19.0.0',
          vite: '^5.0.0',
        },
      }),
      'next.config.ts': 'export default {};',
      'vite.config.ts': 'export default {};',
      'app/layout.tsx': 'export default function RootLayout() { return null; }',
      'app/page.tsx': 'export default function Page() { return null; }',
    };

    const result = validateFrameworkContract('nextjs', hybridFiles);
    assert.strictEqual(result.valid, false);
    assert.ok(result.diagnostics.some((e) => e.includes('Vite') || e.includes('vite.config')));
  });

  it('validates a correct Vite React project contract', () => {
    const viteFiles = {
      'package.json': JSON.stringify({
        name: 'valid-vite-app',
        dependencies: {
          react: '^18.3.0',
          'react-dom': '^18.3.0',
        },
        devDependencies: {
          vite: '^5.4.0',
        },
      }),
      'vite.config.ts': 'import { defineConfig } from "vite"; export default defineConfig({});',
      'index.html': '<!DOCTYPE html><html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>',
      'src/main.tsx': 'import React from "react";',
      'src/App.tsx': 'export default function App() { return <h1>App</h1>; }',
    };

    const result = validateFrameworkContract('vite-react', viteFiles);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.diagnostics.length, 0);
  });

  it('rejects a Vite project missing root index.html or main entry point', () => {
    const brokenVite = {
      'package.json': JSON.stringify({
        name: 'broken-vite',
        devDependencies: { vite: '^5.0.0' },
      }),
      'vite.config.ts': 'export default {};',
      'src/App.tsx': 'export default function App() {}',
    };

    const result = validateFrameworkContract('vite-react', brokenVite);
    assert.strictEqual(result.valid, false);
    assert.ok(result.diagnostics.some((e) => e.includes('index.html')));
    assert.ok(result.diagnostics.some((e) => e.includes('src/main')));
  });

  it('rejects files claiming to be Vite but with Next.js specific config/dependencies', () => {
    const mismatchedFiles = {
      'package.json': JSON.stringify({
        name: 'mismatched',
        dependencies: {
          next: '^15.0.0',
          vite: '^5.0.0',
        },
      }),
      'vite.config.ts': 'export default {};',
      'index.html': '<html><div id="root"></div><script type="module" src="/src/main.tsx"></script></html>',
      'src/main.tsx': 'console.log(1);',
    };

    const result = validateFrameworkContract('vite-react', mismatchedFiles);
    assert.strictEqual(result.valid, false);
    assert.ok(result.diagnostics.some((e) => e.includes('next')));
  });
});