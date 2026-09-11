/**
 * Instant Preview HTML Generator
 * Inspired by llamacoder - compiles multi-file React/Next.js/Vite projects
 * in-browser in < 500ms using Babel standalone, Tailwind CDN, and esm.sh
 */

export function generateInstantPreviewHtml(files: Record<string, string>): string {
  // Serialize files safely for injection into iframe script
  const filesJson = JSON.stringify(files);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Instant Preview</title>
  
  <!-- Tailwind CSS CDN -->
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            border: "hsl(214.3 31.8% 91.4%)",
            input: "hsl(214.3 31.8% 91.4%)",
            ring: "hsl(222.2 84% 4.9%)",
            background: "hsl(0 0% 100%)",
            foreground: "hsl(222.2 84% 4.9%)",
            primary: {
              DEFAULT: "hsl(222.2 47.4% 11.2%)",
              foreground: "hsl(210 40% 98%)",
            },
            secondary: {
              DEFAULT: "hsl(210 40% 96.1%)",
              foreground: "hsl(222.2 47.4% 11.2%)",
            },
            destructive: {
              DEFAULT: "hsl(0 84.2% 60.2%)",
              foreground: "hsl(210 40% 98%)",
            },
            muted: {
              DEFAULT: "hsl(210 40% 96.1%)",
              foreground: "hsl(215.4 16.3% 46.9%)",
            },
            accent: {
              DEFAULT: "hsl(210 40% 96.1%)",
              foreground: "hsl(222.2 47.4% 11.2%)",
            },
            card: {
              DEFAULT: "hsl(0 0% 100%)",
              foreground: "hsl(222.2 84% 4.9%)",
            },
          },
        },
      },
    };
  </script>

  <!-- Babel Standalone for Instant In-Browser TSX/JSX Compilation -->
  <script src="https://cdn.jsdelivr.net/npm/@babel/standalone@7.24.0/babel.min.js"></script>

  <style>
    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      min-height: 100vh;
      background-color: #ffffff;
      color: #0f172a;
    }
    #error-container {
      display: none;
      padding: 1.5rem;
      margin: 1.5rem;
      background: #fef2f2;
      border: 1px solid #fecaca;
      border-radius: 0.75rem;
      color: #991b1b;
      font-family: monospace;
      font-size: 0.875rem;
      white-space: pre-wrap;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    }
    #loading-spinner {
      position: fixed;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: #09090b;
      color: #a1a1aa;
      font-family: system-ui, -apple-system, sans-serif;
      gap: 12px;
      z-index: 9999;
      transition: opacity 0.2s ease-out;
    }
    .spinner {
      width: 36px;
      height: 36px;
      border: 3px solid rgba(59, 130, 246, 0.2);
      border-top-color: #3b82f6;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  <div id="loading-spinner">
    <div class="spinner"></div>
    <div style="font-size: 13px; font-weight: 500;">Building Instant Preview...</div>
  </div>
  <div id="error-container"></div>
  <div id="root"></div>

  <script type="module">
    const rawFiles = ${filesJson};

    function showError(title, details) {
      const spinner = document.getElementById('loading-spinner');
      if (spinner) spinner.style.display = 'none';
      const container = document.getElementById('error-container');
      if (container) {
        container.style.display = 'block';
        container.innerHTML = '<h3 style="font-weight:bold;margin-bottom:8px;">⚠️ ' + title + '</h3>' + details;
      }
      console.error('[Preview Error]', title, details);
      try {
        window.parent.postMessage({ type: 'preview-error', error: title + ': ' + String(details) }, '*');
      } catch (e) {}
    }

    window.onerror = function(msg, url, line, col, error) {
      showError('Runtime Error', (error ? error.stack : msg) + ' (line ' + line + ')');
    };

    window.onunhandledrejection = function(e) {
      showError('Promise Rejection', e.reason ? (e.reason.stack || e.reason) : e);
    };

    // Pre-installed fallback utilities
    const defaultFiles = {
      'lib/utils.ts': \`
        export function cn(...inputs) {
          return inputs.filter(Boolean).join(' ');
        }
      \`,
      'components/ui/button.tsx': \`
        import React from 'react';
        export const Button = React.forwardRef(({ className = '', variant = 'default', children, ...props }, ref) => {
          const base = 'inline-flex items-center justify-center rounded-lg text-sm font-medium transition-colors px-4 py-2 cursor-pointer';
          const styles = variant === 'outline'
            ? 'border border-slate-300 bg-transparent hover:bg-slate-100 text-slate-900'
            : 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm';
          return React.createElement('button', { ref, className: base + ' ' + styles + ' ' + className, ...props }, children);
        });
      \`,
      'components/ui/card.tsx': \`
        import React from 'react';
        export const Card = ({ className = '', children, ...props }) => 
          React.createElement('div', { className: 'rounded-xl border border-slate-200 bg-white shadow-sm ' + className, ...props }, children);
        export const CardHeader = ({ className = '', children, ...props }) => 
          React.createElement('div', { className: 'flex flex-col space-y-1.5 p-6 ' + className, ...props }, children);
        export const CardTitle = ({ className = '', children, ...props }) => 
          React.createElement('h3', { className: 'text-xl font-semibold leading-none tracking-tight text-slate-900 ' + className, ...props }, children);
        export const CardDescription = ({ className = '', children, ...props }) => 
          React.createElement('p', { className: 'text-sm text-slate-500 ' + className, ...props }, children);
        export const CardContent = ({ className = '', children, ...props }) => 
          React.createElement('div', { className: 'p-6 pt-0 ' + className, ...props }, children);
        export const CardFooter = ({ className = '', children, ...props }) => 
          React.createElement('div', { className: 'flex items-center p-6 pt-0 ' + className, ...props }, children);
      \`,
      'components/ui/badge.tsx': \`
        import React from 'react';
        export const Badge = ({ className = '', variant = 'default', children, ...props }) => {
          const styles = variant === 'outline' 
            ? 'border border-slate-300 text-slate-700' 
            : 'bg-blue-100 text-blue-800';
          return React.createElement('span', { className: 'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ' + styles + ' ' + className, ...props }, children);
        };
      \`
    };

    async function bootstrap() {
      try {
        if (typeof Babel === 'undefined') {
          showError('Compiler Loading Error', 'Babel standalone compiler could not be loaded from CDN. Please check your internet connection.');
          return;
        }

        const mergedFiles = { ...defaultFiles, ...rawFiles };
        const blobMap = {};
        const usedFallbacks = [];

        // 1. Transpile all .ts / .tsx / .jsx / .js files
        for (const [rawPath, content] of Object.entries(mergedFiles)) {
          if (!rawPath.match(/\\.(tsx|ts|jsx|js)$/)) continue;
          
          const cleanPath = rawPath.replace(/^\\/+/, '');
          
          try {
            // Strip 'use client' directives
            const cleanContent = content.replace(/^['"]use client['"];?\\s*/gm, '');

            const compiled = Babel.transform(cleanContent, {
              presets: [
                ['react', { runtime: 'automatic' }],
                ['typescript', { isTSX: true, allExtensions: true }]
              ],
              filename: cleanPath
            }).code;

            const blob = new Blob([compiled], { type: 'application/javascript' });
            const blobUrl = URL.createObjectURL(blob);
            
            // Map variations of path
            const noExt = cleanPath.replace(/\\.(tsx|ts|jsx|js)$/, '');
            blobMap[cleanPath] = blobUrl;
            blobMap[noExt] = blobUrl;
            blobMap['@/' + cleanPath] = blobUrl;
            blobMap['@/' + noExt] = blobUrl;
            blobMap['./' + cleanPath] = blobUrl;
            blobMap['./' + noExt] = blobUrl;
            
            // Short filename mapping (e.g. Navbar.tsx -> Navbar)
            const parts = noExt.split('/');
            const baseName = parts[parts.length - 1];
            blobMap['./' + baseName] = blobUrl;
            blobMap['../' + baseName] = blobUrl;
            blobMap['./' + baseName + '.tsx'] = blobUrl;
            blobMap['../components/' + baseName] = blobUrl;
            blobMap['./components/' + baseName] = blobUrl;
            blobMap['@/components/' + baseName] = blobUrl;
          } catch (compileErr) {
            console.error('[Compile Error for ' + cleanPath + ']:', compileErr);
            showError('Syntax/Compile Error in ' + cleanPath, compileErr.message || String(compileErr));
          }
        }

        // 2. Build import map — with pre-resolved packages + dynamic bare-specifier resolver
        const KNOWN_PACKAGES = {
          "react": "https://esm.sh/react@19?dev",
          "react/jsx-runtime": "https://esm.sh/react@19/jsx-runtime?dev",
          "react/jsx-dev-runtime": "https://esm.sh/react@19/jsx-dev-runtime?dev",
          "react-dom": "https://esm.sh/react-dom@19?dev",
          "react-dom/client": "https://esm.sh/react-dom@19/client?dev",
          "lucide-react": "https://esm.sh/lucide-react@0.475.0?dev",
          "framer-motion": "https://esm.sh/framer-motion@11.3.31?dev",
          "clsx": "https://esm.sh/clsx@2.1.0?dev",
          "tailwind-merge": "https://esm.sh/tailwind-merge@2.2.1?dev",
          "zustand": "https://esm.sh/zustand@4.5.2?dev",
          "@supabase/supabase-js": "https://esm.sh/@supabase/supabase-js@2.39.8?dev",
          "canvas-confetti": "https://esm.sh/canvas-confetti@1.9.2?dev",
          "axios": "https://esm.sh/axios@1.6.8?dev",
          "date-fns": "https://esm.sh/date-fns@3.6.0?dev",
          "recharts": "https://esm.sh/recharts@2.12.7?dev",
          "chart.js": "https://esm.sh/chart.js@4.4.2?dev",
          "react-chartjs-2": "https://esm.sh/react-chartjs-2@5.2.0?dev",
          "react-hot-toast": "https://esm.sh/react-hot-toast@2.4.1?dev",
          "react-router-dom": "https://esm.sh/react-router-dom@6.23.1?dev",
          "react-query": "https://esm.sh/react-query@3.39.3?dev",
          "@tanstack/react-query": "https://esm.sh/@tanstack/react-query@5.45.0?dev",
          "immer": "https://esm.sh/immer@10.1.1?dev",
        };

        // Auto-resolve any bare imports in user files not already in KNOWN_PACKAGES
        const allFileContent = Object.values(rawFiles).join('\\n');
        const bareImportRegex = /from\\s+['"]([^./][^'"]*)['"]/g;
        const extraImports = {};
        let m;
        while ((m = bareImportRegex.exec(allFileContent)) !== null) {
          const pkg = m[1];
          // Skip if already known, or if it's a blob/http import
          if (!KNOWN_PACKAGES[pkg] && !blobMap[pkg] && !pkg.startsWith('http') && !pkg.startsWith('blob')) {
            const basePkg = pkg.split('/').slice(0, pkg.startsWith('@') ? 2 : 1).join('/');
            if (!KNOWN_PACKAGES[basePkg] && !extraImports[pkg]) {
              extraImports[pkg] = 'https://esm.sh/' + pkg + '?dev';
            }
          }
        }

        const importMap = {
          imports: {
            ...KNOWN_PACKAGES,
            ...extraImports,
            ...blobMap,
          }
        };

        const mapScript = document.createElement('script');
        mapScript.type = 'importmap';
        mapScript.textContent = JSON.stringify(importMap);
        document.head.appendChild(mapScript);

        // 3. Find root entry component
        const entryCandidates = [
          'app/page.tsx',
          'app/page.jsx',
          'app/page.js',
          'pages/index.tsx',
          'pages/index.jsx',
          'src/App.tsx',
          'src/App.jsx',
          'App.tsx',
          'App.jsx'
        ];

        let entryPath = entryCandidates.find(p => blobMap[p]);
        if (!entryPath) {
          // Find any main component
          entryPath = Object.keys(rawFiles).find(p => p.match(/page\\.(tsx|jsx)$/) || p.match(/App\\.(tsx|jsx)$/));
        }
        if (!entryPath) {
          // Fallback to first tsx/jsx file
          entryPath = Object.keys(rawFiles).find(p => p.endsWith('.tsx') || p.endsWith('.jsx'));
        }

        if (!entryPath || !blobMap[entryPath]) {
          showError('No Component Found', 'Could not find app/page.tsx or App.tsx in project files.');
          return;
        }

        // 4. Import React & Entry module
        const [React, ReactDOM, EntryModule] = await Promise.all([
          import('https://esm.sh/react@19?dev'),
          import('https://esm.sh/react-dom@19/client?dev'),
          import(blobMap[entryPath])
        ]);

        const Component = EntryModule.default || EntryModule[Object.keys(EntryModule)[0]];
        if (!Component) {
          showError('Export Missing', entryPath + ' does not have a default export.');
          return;
        }

        // 5. Render App
        const rootElem = document.getElementById('root');
        const root = ReactDOM.createRoot(rootElem);
        root.render(React.createElement(Component));

        // Hide loading spinner
        const spinner = document.getElementById('loading-spinner');
        if (spinner) {
          spinner.style.opacity = '0';
          setTimeout(() => spinner.remove(), 200);
        }

        // Detect which system fallback files were used (not overridden by AI)
        const fallbackKeys = Object.keys(defaultFiles);
        const aiKeys = Object.keys(rawFiles);
        const usedFallbacks = fallbackKeys.filter(k => !aiKeys.includes(k));
        if (usedFallbacks.length > 0) {
          try {
            window.parent.postMessage({
              type: 'preview-fallback-warning',
              fallbacks: usedFallbacks.map(f => f.split('/').pop()),
            }, '*');
          } catch(e) {}
        }

        // Auto-screenshot after React has painted
        setTimeout(async () => {
          try {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
            document.head.appendChild(s);
            await new Promise((resolve, reject) => { s.onload = resolve; s.onerror = reject; });
            const canvas = await html2canvas(document.body, { useCORS: true, scale: 1, logging: false });
            const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
            window.parent.postMessage({ type: 'preview-screenshot', dataUrl }, '*');
          } catch (_e) {
            // Screenshot failed silently — preview still works
          }
        }, 2500);

      } catch (err) {
        showError('Execution Error', err?.stack || String(err));
      }
    }

    bootstrap();
  </script>
</body>
</html>`;
}
