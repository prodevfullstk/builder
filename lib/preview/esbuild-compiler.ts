/**
 * In-browser esbuild compiler and Virtual FS bundler
 * Uses esbuild-wasm loaded dynamically from CDN — no npm install needed
 * Compiles multi-file React/TSX apps in ~50ms
 */

// Dynamic CDN import — avoids pnpm-lock.yaml conflict
const ESBUILD_CDN = 'https://esm.sh/esbuild-wasm@0.28.2';
const ESBUILD_WASM_URL = 'https://unpkg.com/esbuild-wasm@0.28.2/esbuild.wasm';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let esbuildInstance: any = null;
let initPromise: Promise<void> | null = null;

async function getEsbuild() {
  if (esbuildInstance) return esbuildInstance;
  if (!initPromise) {
    initPromise = (async () => {
      const mod = await import(/* webpackIgnore: true */ ESBUILD_CDN);
      await mod.initialize({ worker: false, wasmURL: ESBUILD_WASM_URL });
      esbuildInstance = mod;
    })();
  }
  await initPromise;
  return esbuildInstance;
}

const EXTENSIONS = ['', '.tsx', '.ts', '.jsx', '.js', '.css', '.json'];

function cleanPath(p: string): string {
  const colonIdx = p.indexOf(':');
  if (colonIdx === -1) return p;
  if (p[colonIdx + 1] === '/' && p[colonIdx + 2] === '/') return p;
  const slashIdx = p.indexOf('/');
  if (slashIdx === -1 || colonIdx < slashIdx) {
    return p.substring(colonIdx + 1);
  }
  return p;
}

function normalizePath(path: string): string {
  const parts = path.split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') {
      out.pop();
    } else if (p !== '.' && p !== '') {
      out.push(p);
    }
  }
  return '/' + out.join('/');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getLoader(path: string): any {
  if (path.endsWith('.tsx')) return 'tsx';
  if (path.endsWith('.ts')) return 'ts';
  if (path.endsWith('.jsx')) return 'jsx';
  if (path.endsWith('.css')) return 'css';
  if (path.endsWith('.json')) return 'json';
  return 'js';
}

function createVirtualFsPlugin(files: Record<string, string>) {
  const lookup: Record<string, string> = {};
  for (const [key, value] of Object.entries(files)) {
    const cleanKey = key.replace(/^\/+/, '');
    lookup[cleanKey] = value;
    lookup['/' + cleanKey] = value;
  }

  return {
    name: 'virtual-fs',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setup(build: any) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      build.onResolve({ filter: /.*/ }, (args: any) => {
        if (args.path.startsWith('https://') || args.path.startsWith('http://')) {
          return { path: args.path, external: true };
        }

        let resolvedPath = cleanPath(args.path);

        if (args.path.startsWith('.')) {
          const importerClean = cleanPath(args.importer || '');
          const dir = importerClean ? importerClean.replace(/\/[^/]*$/, '') : '/src';
          resolvedPath = normalizePath(`${dir}/${args.path}`);
        } else if (args.path.startsWith('@/')) {
          resolvedPath = normalizePath('/' + args.path.slice(2));
        } else if (!resolvedPath.startsWith('/')) {
          return { path: resolvedPath, external: true };
        }

        const candidateClean = resolvedPath.replace(/^\/+/, '');

        for (const ext of EXTENSIONS) {
          const candidate = candidateClean + ext;
          if (lookup[candidate] !== undefined || lookup['/' + candidate] !== undefined) {
            return { path: '/' + candidate, namespace: 'virtual' };
          }
        }

        for (const ext of ['.tsx', '.ts', '.jsx', '.js']) {
          const candidate = candidateClean.replace(/\/$/, '') + '/index' + ext;
          if (lookup[candidate] !== undefined || lookup['/' + candidate] !== undefined) {
            return { path: '/' + candidate, namespace: 'virtual' };
          }
        }

        return { path: args.path, external: true };
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      build.onLoad({ filter: /.*/, namespace: 'virtual' }, (args: any) => {
        const clean = cleanPath(args.path).replace(/^\/+/, '');
        let content = lookup[clean] ?? lookup['/' + clean];

        if (content === undefined) {
          if (clean.includes('utils')) {
            content = `export function cn(...inputs) { return inputs.filter(Boolean).join(' '); }`;
          } else {
            content = `export default function() { return null; }`;
          }
        }

        const stripped = content.replace(/^['""]use client['"];?\s*/gm, '');

        return {
          contents: stripped,
          loader: getLoader(clean),
          resolveDir: '/' + clean.substring(0, clean.lastIndexOf('/')),
        };
      });
    },
  };
}

export interface BundleResult {
  html: string;
  errors: string[];
}

/**
 * Bundle project files and generate standalone HTML.
 * Loaded dynamically — no npm dependency on esbuild-wasm needed.
 */
export async function bundleProjectWithEsbuild(
  files: Record<string, string>,
  backendUrl?: string
): Promise<BundleResult> {
  const esbuild = await getEsbuild();

  const candidates = [
    'app/page.tsx', 'app/page.jsx',
    'src/App.tsx', 'src/App.jsx',
    'App.tsx', 'App.jsx',
  ];

  let entryFile = candidates.find((c) => files[c] || files['/' + c]);
  if (!entryFile) {
    entryFile = Object.keys(files).find((f) => f.endsWith('.tsx') || f.endsWith('.jsx'));
  }

  if (!entryFile) {
    return { html: '', errors: ['No React component found to render.'] };
  }

  const cleanEntry = entryFile.replace(/^\/+/, '').replace(/\.(tsx|jsx)$/, '');

  const virtualEntrySource = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import RootComponent from '/${cleanEntry}';
const rootEl = document.getElementById('root');
if (rootEl) { createRoot(rootEl).render(React.createElement(RootComponent)); }
`;

  const filesMap: Record<string, string> = {
    ...files,
    '/__entry__.tsx': virtualEntrySource,
    'lib/utils.ts':
      files['lib/utils.ts'] ||
      files['/lib/utils.ts'] ||
      `export function cn(...inputs) { return inputs.filter(Boolean).join(' '); }`,
  };

  try {
    const buildResult = await esbuild.build({
      entryPoints: ['virtual:/__entry__.tsx'],
      bundle: true,
      write: false,
      format: 'esm',
      target: 'es2020',
      jsx: 'automatic',
      minify: false,
      plugins: [createVirtualFsPlugin(filesMap)],
    });

    const outFiles = buildResult.outputFiles || [];
    const jsFile = outFiles.find((f: any) => f.path.endsWith('.js'));
    const cssFile = outFiles.find((f: any) => f.path.endsWith('.css'));

    const safeJs = (jsFile?.text || '').replace(/<\/script>/gi, '<\\/script>');
    const cssBlock = cssFile ? `<style>\n${cssFile.text}\n</style>` : '';

    const importMap = JSON.stringify({
      imports: {
        react: 'https://esm.sh/react@19?dev',
        'react/jsx-runtime': 'https://esm.sh/react@19/jsx-runtime?dev',
        'react-dom': 'https://esm.sh/react-dom@19?dev',
        'react-dom/client': 'https://esm.sh/react-dom@19/client?dev',
        'lucide-react': 'https://esm.sh/lucide-react@latest?dev',
        'framer-motion': 'https://esm.sh/framer-motion@latest?dev',
        clsx: 'https://esm.sh/clsx?dev',
        'tailwind-merge': 'https://esm.sh/tailwind-merge?dev',
        zustand: 'https://esm.sh/zustand@latest?dev',
      },
    }, null, 2);

    const apiBridgeShim = backendUrl
      ? `<script>
(function() {
  const b = "${backendUrl}";
  const o = window.fetch;
  window.fetch = function(u, i) {
    if (typeof u === 'string' && u.startsWith('/api/')) u = b + u;
    return o(u, i);
  };
})();
</script>`
      : '';

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>App Preview</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script type="importmap">
${importMap}
  </script>
  ${apiBridgeShim}
  ${cssBlock}
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { margin: 0; padding: 0; font-family: system-ui, -apple-system, sans-serif; background-color: #09090b; color: #f4f4f5; min-height: 100vh; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="module">
${safeJs}
  </script>
</body>
</html>`;

    return { html, errors: [] };
  } catch (err: any) {
    return { html: '', errors: [err?.message || String(err)] };
  }
}
