/**
 * Instant Preview HTML Generator
 * Fast in-browser React/Next.js/Vite compilation engine
 * Compiles multi-file workspaces using Babel standalone, Tailwind CDN, and esm.sh
 */

export function generateInstantPreviewHtml(files: Record<string, string>): string {
  // Pre-configured stable CDN packages
  const KNOWN_PACKAGES: Record<string, string> = {
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

  // Scan user files for additional bare imports right here in TypeScript
  const extraImports: Record<string, string> = {};
  for (const content of Object.values(files)) {
    if (typeof content !== 'string') continue;
    const matches = content.matchAll(/(?:from|import)\s+['"]([^./][^'"]*)['"]/g);
    for (const m of matches) {
      const pkg = m[1];
      if (!KNOWN_PACKAGES[pkg] && !pkg.startsWith('http') && !pkg.startsWith('blob')) {
        const basePkg = pkg.split('/').slice(0, pkg.startsWith('@') ? 2 : 1).join('/');
        if (!KNOWN_PACKAGES[basePkg] && !extraImports[pkg]) {
          extraImports[pkg] = `https://esm.sh/${pkg}?dev`;
        }
      }
    }
  }

  const baseImportsJson = JSON.stringify({ ...KNOWN_PACKAGES, ...extraImports });

  // Collect all project CSS files to inject into a <style> tag
  let projectCss = '';
  for (const [path, content] of Object.entries(files)) {
    if (path.endsWith('.css') && typeof content === 'string') {
      projectCss += `\n/* ${path} */\n${content}\n`;
    }
  }
  const safeProjectCss = projectCss.replace(/<\/style>/gi, '<\\/style>');

  // CRITICAL: Escape < and > so </script> inside index.html or code never closes the script tag prematurely!
  const safeFilesJson = JSON.stringify(files)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Instant Preview</title>
  
  <script>
    // Graceful image fallback for broken or placeholder avatar URLs
    window.addEventListener('error', function(e) {
      if (e.target && e.target.tagName === 'IMG') {
        e.target.onerror = null;
        e.target.src = 'https://api.dicebear.com/7.x/avataaars/svg?seed=GamifiedUser';
      }
    }, true);
  </script>

  <style id="project-custom-css">
    ${safeProjectCss}
  </style>
  
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

  <script>
    const rawFiles = ${safeFilesJson};

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

        function normalizePath(baseDir, relativePath) {
          if (relativePath.startsWith('@/')) {
            relativePath = relativePath.slice(2);
            return relativePath.replace(/^\\/+/, '');
          }
          const parts = (baseDir ? baseDir + '/' + relativePath : relativePath).split('/');
          const stack = [];
          for (const p of parts) {
            if (p === '..') {
              if (stack.length > 0) stack.pop();
            } else if (p !== '.' && p !== '') {
              stack.push(p);
            }
          }
          return stack.join('/');
        }

        // Map CSS files to empty JS modules so browser ES modules never fail on CSS imports
        const emptyCssBlob = new Blob(['export default {};'], { type: 'application/javascript' });
        const emptyCssUrl = URL.createObjectURL(emptyCssBlob);
        const cssStubs = [
          './index.css', '../index.css', 'index.css',
          './App.css', '../App.css', 'App.css',
          './globals.css', '../globals.css', '@/globals.css', '@/app/globals.css',
          './styles.css', '../styles.css', 'styles.css'
        ];
        for (const s of cssStubs) {
          blobMap[s] = emptyCssUrl;
          blobMap['__vfs__/' + s.replace(/^(\\.\\/|\\.\\.\\/|@\\/)/, '')] = emptyCssUrl;
        }

        // 1. Transpile all .ts / .tsx / .jsx / .js files
        for (const [rawPath, content] of Object.entries(mergedFiles)) {
          if (!rawPath.match(/\\.(tsx|ts|jsx|js)$/)) continue;
          
          const cleanPath = rawPath.startsWith('/') ? rawPath.slice(1) : rawPath;
          const currentDir = cleanPath.includes('/') ? cleanPath.substring(0, cleanPath.lastIndexOf('/')) : '';
          
          try {
            // Strip 'use client' directives, CSS imports, JSX src="{var}" mistake, and mock avatar URL templates
            let cleanContent = content
              .replace(/^['"]use client['"];?\\s*/gm, '')
              .replace(/import\\s+['"][^'"]+\\.css['"];?\\s*/g, '')
              .replace(/\\b(src|href)=["']\\{([^}]+)\\}["']/g, '$1={$2}')
              .replace(/["']\\{(?:user|profile)\\.avatar_url\\}["']/g, '"https://api.dicebear.com/7.x/avataaars/svg?seed=GamifiedUser"')
              .replace(/\\{profile\\?\\.avatar_url\\s*\\|\\|\\s*['"][^'"]+['"]\\}/g, '{profile?.avatar_url || "https://api.dicebear.com/7.x/avataaars/svg?seed=GamifiedUser"}');

            // CRITICAL FIX: Rewrite relative and alias imports to bare '__vfs__/*' specifiers
            // In browser ES modules, blob: URLs are non-hierarchical, so relative imports fail unless rewritten to bare specifiers
            cleanContent = cleanContent.replace(
              /((?:from|import)\\s+['"]|import\\s*\\(\\s*['"])([^'"]+)(['"]\\s*\\)?)/g,
              function(match, prefix, specifier, suffix) {
                if (specifier.startsWith('.') || specifier.startsWith('@/')) {
                  const normalized = normalizePath(currentDir, specifier);
                  return prefix + '__vfs__/' + normalized + suffix;
                }
                return match;
              }
            );

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
            
            // 1. Bare virtual paths
            blobMap['__vfs__/' + cleanPath] = blobUrl;
            blobMap['__vfs__/' + noExt] = blobUrl;
            
            // 2. Dual paths for src/ vs root
            if (cleanPath.startsWith('src/')) {
              blobMap['__vfs__/' + cleanPath.slice(4)] = blobUrl;
              blobMap['__vfs__/' + noExt.slice(4)] = blobUrl;
            } else {
              blobMap['__vfs__/src/' + cleanPath] = blobUrl;
              blobMap['__vfs__/src/' + noExt] = blobUrl;
            }
            
            // 3. Basename & short path mappings
            const parts = noExt.split('/');
            const baseName = parts[parts.length - 1];
            blobMap['__vfs__/' + baseName] = blobUrl;
            blobMap['__vfs__/' + baseName + '.tsx'] = blobUrl;
            blobMap['__vfs__/components/' + baseName] = blobUrl;
            blobMap['__vfs__/hooks/' + baseName] = blobUrl;

            // 4. Legacy and standard aliases
            blobMap[cleanPath] = blobUrl;
            blobMap[noExt] = blobUrl;
            blobMap['@/' + cleanPath] = blobUrl;
            blobMap['@/' + noExt] = blobUrl;
            if (cleanPath.startsWith('src/')) {
              blobMap['@/' + cleanPath.slice(4)] = blobUrl;
              blobMap['@/' + noExt.slice(4)] = blobUrl;
            }
          } catch (compileErr) {
            console.error('[Compile Error for ' + cleanPath + ']:', compileErr);
            showError('Syntax/Compile Error in ' + cleanPath, compileErr.message || String(compileErr));
          }
        }

        // Graceful fallbacks for common components in case any sub-component is missing
        const stubBlob = new Blob([
          \`import React from 'react';
           export default function FallbackComponent() { return null; }
           export const Navbar = FallbackComponent;
           export const Hero = FallbackComponent;
           export const InteractiveDemo = FallbackComponent;
           export const Features = FallbackComponent;
           export const RoiCalculator = FallbackComponent;
           export const Testimonials = FallbackComponent;
           export const Pricing = FallbackComponent;
           export const Faq = FallbackComponent;
           export const CtaBanner = FallbackComponent;
           export const Footer = FallbackComponent;
           export const DemoModal = FallbackComponent;
           export function useLandingState() {
             return {
               billingCycle: 'monthly',
               toggleBilling: () => {},
               isDemoModalOpen: false,
               setIsDemoModalOpen: () => {},
               nodes: [],
               isSimulating: false,
               handleRunSimulation: () => {},
               handleSubscribe: () => {},
               toastMessage: null,
               showToast: () => {}
             };
           }
          \`
        ], { type: 'application/javascript' });
        const stubUrl = URL.createObjectURL(stubBlob);

        const commonStubs = [
          'Navbar', 'Hero', 'InteractiveDemo', 'Features', 'RoiCalculator',
          'Testimonials', 'Pricing', 'Faq', 'CtaBanner', 'Footer', 'DemoModal',
          'useLandingState', 'components/Navbar', 'components/Hero',
          'components/InteractiveDemo', 'components/Features', 'components/RoiCalculator',
          'components/Testimonials', 'components/Pricing', 'components/Faq',
          'components/CtaBanner', 'components/Footer', 'components/DemoModal',
          'hooks/useLandingState', 'src/components/Navbar', 'src/components/Hero',
          'src/components/InteractiveDemo', 'src/components/Features',
          'src/components/RoiCalculator', 'src/components/Testimonials',
          'src/components/Pricing', 'src/components/Faq', 'src/components/CtaBanner',
          'src/components/Footer', 'src/components/DemoModal', 'src/hooks/useLandingState'
        ];
        for (const cs of commonStubs) {
          if (!blobMap['__vfs__/' + cs]) blobMap['__vfs__/' + cs] = stubUrl;
        }

        // 2. Build import map
        const baseImports = ${baseImportsJson};
        const importMap = {
          imports: {
            ...baseImports,
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
          'src/App.tsx',
          'src/App.jsx',
          'App.tsx',
          'App.jsx',
          'pages/index.tsx',
          'pages/index.jsx',
          'src/main.tsx',
          'src/main.jsx',
          'main.tsx',
          'main.jsx',
        ];

        let entryPath = entryCandidates.find(p => blobMap[p] || blobMap['__vfs__/' + p]);
        if (!entryPath) {
          // Find any main component
          entryPath = Object.keys(rawFiles).find(p => p.match(/page\\.(tsx|jsx)$/) || p.match(/App\\.(tsx|jsx)$/) || p.match(/main\\.(tsx|jsx)$/));
        }
        if (!entryPath) {
          // Fallback to first tsx/jsx file
          entryPath = Object.keys(rawFiles).find(p => p.endsWith('.tsx') || p.endsWith('.jsx'));
        }

        if (!entryPath || (!blobMap[entryPath] && !blobMap['__vfs__/' + entryPath])) {
          showError('No Component Found', 'Could not find app/page.tsx or App.tsx in project files.');
          return;
        }

        // 4. Import React & Entry module
        const entryModuleUrl = blobMap[entryPath] || blobMap['__vfs__/' + entryPath];
        const [React, ReactDOM, EntryModule] = await Promise.all([
          import('https://esm.sh/react@19?dev'),
          import('https://esm.sh/react-dom@19/client?dev'),
          import(entryModuleUrl)
        ]);

        const rootElem = document.getElementById('root');
        const Component = EntryModule.default || EntryModule[Object.keys(EntryModule)[0]];
        if (!Component) {
          if (rootElem && rootElem.children.length > 0) {
            // Already mounted by entry module itself (e.g. main.tsx mounting createRoot)
          } else {
            showError('Export Missing', entryPath + ' does not have a default export.');
            return;
          }
        } else {
          // 5. Render App
          const root = ReactDOM.createRoot(rootElem);
          root.render(React.createElement(Component));
        }

        // Hide loading spinner
        const spinner = document.getElementById('loading-spinner');
        if (spinner) {
          spinner.style.opacity = '0';
          setTimeout(() => spinner.remove(), 200);
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
