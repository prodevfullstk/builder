import { ValidationCheck } from './types';

export interface FrameworkValidationOutput {
  valid: boolean;
  checks: ValidationCheck[];
  diagnostics: string[];
}

/**
 * Deterministic Framework Contract Validator
 *
 * Verifies that the candidate project strictly matches the requested framework contract.
 * Does NOT attempt to automatically "fix" framework mismatches.
 */
export function validateFrameworkContract(
  framework: string,
  files: Record<string, string>
): FrameworkValidationOutput {
  const normalizedFramework = (framework || 'nextjs').toLowerCase().trim();
  const filePaths = Object.keys(files).map((p) => p.replace(/^\/+/, ''));
  const checks: ValidationCheck[] = [];
  const diagnostics: string[] = [];

  // 1. Package Manifest Check
  const packageJsonRaw = files['package.json'] || files['/package.json'];
  let packageJson: any = null;

  if (!packageJsonRaw) {
    checks.push({
      name: 'package_manifest_exists',
      status: 'failed',
      message: 'package.json is missing from project files.',
    });
    diagnostics.push('Missing package.json in project files.');
  } else {
    try {
      packageJson = JSON.parse(packageJsonRaw);
      checks.push({
        name: 'package_manifest_exists',
        status: 'passed',
        message: 'package.json is valid JSON.',
      });
    } catch (e: any) {
      checks.push({
        name: 'package_manifest_valid_json',
        status: 'failed',
        message: `package.json is not valid JSON: ${e?.message || 'Parse error'}`,
      });
      diagnostics.push(`package.json is not valid JSON: ${e?.message || 'Parse error'}`);
    }
  }

  const allDeps: Record<string, string> = {
    ...(packageJson?.dependencies || {}),
    ...(packageJson?.devDependencies || {}),
  };

  switch (normalizedFramework) {
    case 'nextjs': {
      // 1. Must contain Next.js dependency
      const hasNextDep = Boolean(allDeps['next']);
      if (hasNextDep) {
        checks.push({
          name: 'nextjs_dependency_check',
          status: 'passed',
          message: `Next.js dependency present (${allDeps['next']}).`,
        });
      } else {
        checks.push({
          name: 'nextjs_dependency_check',
          status: 'failed',
          message: "package.json missing 'next' dependency.",
        });
        diagnostics.push("Next.js framework contract violated: package.json is missing 'next' dependency.");
      }

      // 2. Appropriate Next.js file structure exists (app/ or pages/)
      const hasAppDir = filePaths.some((p) => p.startsWith('app/'));
      const hasPagesDir = filePaths.some((p) => p.startsWith('pages/'));
      if (hasAppDir || hasPagesDir) {
        checks.push({
          name: 'nextjs_structure_check',
          status: 'passed',
          message: `Valid Next.js router directory detected (${hasAppDir ? 'app router' : 'pages router'}).`,
        });

        // For App Router, root layout is strictly mandatory
        if (hasAppDir) {
          const hasAppLayout = filePaths.some((p) => /^app\/layout\.(tsx|jsx|js)$/i.test(p));
          if (!hasAppLayout) {
            checks.push({
              name: 'nextjs_app_layout_check',
              status: 'failed',
              message: "Next.js App Router requires root 'app/layout.tsx' (or layout.js).",
            });
            diagnostics.push("Next.js App Router framework contract violated: missing root 'app/layout.tsx'.");
          } else {
            checks.push({
              name: 'nextjs_app_layout_check',
              status: 'passed',
              message: "Root layout present ('app/layout.tsx').",
            });
          }
        }
      } else {
        checks.push({
          name: 'nextjs_structure_check',
          status: 'failed',
          message: "Missing Next.js directory structure (neither 'app/' nor 'pages/' found).",
        });
        diagnostics.push("Next.js framework contract violated: requires 'app/' or 'pages/' directory.");
      }

      // 3. Forbidden Vite-only structure is NOT incorrectly introduced
      const hasViteConfig = filePaths.some((p) => /^vite\.config\.(ts|js|mjs)$/i.test(p));
      const hasRootIndexHtml = filePaths.some((p) => p.toLowerCase() === 'index.html');
      const hasViteMainOnly = filePaths.some((p) => /^src\/main\.(tsx|jsx)$/i.test(p)) && !hasAppDir && !hasPagesDir;
      if (hasViteConfig || (hasRootIndexHtml && !hasAppDir && !hasPagesDir) || hasViteMainOnly) {
        checks.push({
          name: 'nextjs_no_forbidden_vite_artifacts',
          status: 'failed',
          message: 'Forbidden Vite-only structure incorrectly introduced into Next.js project.',
        });
        diagnostics.push('Next.js framework contract violated: Vite configuration artifacts (vite.config / root index.html / standalone src/main) detected.');
      } else {
        checks.push({
          name: 'nextjs_no_forbidden_vite_artifacts',
          status: 'passed',
          message: 'No conflicting Vite artifacts detected in Next.js project.',
        });
      }
      break;
    }

    case 'vite':
    case 'vite-react': {
      // 1. Must contain Vite dependency and not Next.js
      const hasViteDep = Boolean(allDeps['vite']);
      const hasNextDep = Boolean(allDeps['next']);

      if (hasNextDep) {
        checks.push({
          name: 'vite_no_conflicting_next_dependency',
          status: 'failed',
          message: 'Conflicting Next.js dependency found in Vite project.',
        });
        diagnostics.push("Vite framework contract violated: package.json contains conflicting 'next' dependency.");
      }

      if (hasViteDep) {
        checks.push({
          name: 'vite_dependency_check',
          status: 'passed',
          message: `Vite dependency present (${allDeps['vite']}).`,
        });
      } else {
        checks.push({
          name: 'vite_dependency_check',
          status: 'failed',
          message: "package.json missing 'vite' dependency.",
        });
        diagnostics.push("Vite framework contract violated: package.json is missing 'vite' dependency.");
      }

      // 2. Expected Vite entry structure: requires root index.html AND (src/main or src/App)
      const hasIndexHtml = filePaths.some((p) => p.toLowerCase() === 'index.html');
      const hasSrcMain = filePaths.some((p) => /^src\/main\.(tsx|jsx|ts|js)$/i.test(p));

      if (hasIndexHtml) {
        checks.push({
          name: 'vite_index_html_check',
          status: 'passed',
          message: 'Root index.html present for Vite SPA.',
        });
      } else {
        checks.push({
          name: 'vite_index_html_check',
          status: 'failed',
          message: "Missing root 'index.html' required for Vite projects.",
        });
        diagnostics.push("Vite framework contract violated: missing 'index.html' entry point.");
      }

      if (hasSrcMain) {
        checks.push({
          name: 'vite_entry_point_check',
          status: 'passed',
          message: 'Valid Vite main entry point (src/main) detected.',
        });
      } else {
        checks.push({
          name: 'vite_entry_point_check',
          status: 'failed',
          message: "Missing Vite main entry point ('src/main.tsx' or 'src/main.jsx').",
        });
        diagnostics.push("Vite framework contract violated: missing 'src/main.tsx' or 'src/main.jsx'.");
      }

      // 3. Must not introduce Next.js router conventions as primary entry
      const hasNextConfig = filePaths.some((p) => /^next\.config\.(ts|js|mjs)$/i.test(p));
      if (hasNextConfig) {
        checks.push({
          name: 'vite_framework_exclusivity',
          status: 'failed',
          message: 'Conflicting Next.js configuration found in Vite project.',
        });
        diagnostics.push('Vite framework contract violated: next.config present in Vite project.');
      }
      break;
    }

    case 'astro': {
      // 1. Must contain Astro dependency
      const hasAstroDep = Boolean(allDeps['astro']);
      if (hasAstroDep) {
        checks.push({
          name: 'astro_dependency_check',
          status: 'passed',
          message: `Astro dependency present (${allDeps['astro']}).`,
        });
      } else {
        checks.push({
          name: 'astro_dependency_check',
          status: 'failed',
          message: "package.json missing 'astro' dependency.",
        });
        diagnostics.push("Astro framework contract violated: package.json is missing 'astro' dependency.");
      }

      // 2. Expected Astro structure
      const hasAstroPages = filePaths.some((p) => p.startsWith('src/pages/'));
      const hasAstroConfig = filePaths.some((p) => /^astro\.config\.(mjs|ts|js)$/i.test(p));
      if (hasAstroPages || hasAstroConfig) {
        checks.push({
          name: 'astro_structure_check',
          status: 'passed',
          message: 'Valid Astro project structure detected.',
        });
      } else {
        checks.push({
          name: 'astro_structure_check',
          status: 'failed',
          message: "Missing Astro project structure ('src/pages/' or 'astro.config.mjs' required).",
        });
        diagnostics.push("Astro framework contract violated: requires 'src/pages/' or 'astro.config.mjs'.");
      }
      break;
    }

    case 'node': {
      // 1. Node backend package configuration
      const hasNodeEntry = filePaths.some((p) =>
        /^(server|index|app|main)\.(js|ts|mjs)$/i.test(p) ||
        /^(src\/server|src\/index|src\/app)\.(js|ts|mjs)$/i.test(p)
      );

      if (hasNodeEntry) {
        checks.push({
          name: 'node_entry_check',
          status: 'passed',
          message: 'Recognized Node.js backend entry point detected.',
        });
      } else {
        checks.push({
          name: 'node_entry_check',
          status: 'failed',
          message: "Missing Node backend entry point ('server.js', 'index.js', or 'app.js').",
        });
        diagnostics.push("Node backend contract violated: requires recognized entry file ('server.js', 'index.js', etc.).");
      }
      break;
    }

    default:
      checks.push({
        name: 'unknown_framework_check',
        status: 'failed',
        message: `Unsupported framework: ${framework}`,
      });
      diagnostics.push(`Unsupported framework requested: ${framework}`);
      break;
  }

  const hasFailedCheck = checks.some((c) => c.status === 'failed');

  return {
    valid: !hasFailedCheck,
    checks,
    diagnostics,
  };
}

/**
 * Deterministic Framework Scaffold Generator
 * Ensures that essential framework boilerplate (package.json, layout, entry points)
 * is present during new builds even if omitted by the AI generator.
 */
export function ensureFrameworkScaffold(
  framework: string,
  files: Record<string, string>
): Record<string, string> {
  const normalized = (framework || 'nextjs').toLowerCase().trim();
  const result: Record<string, string> = { ...files };

  if (normalized === 'nextjs') {
    // 1. package.json
    if (!result['package.json'] && !result['/package.json']) {
      result['package.json'] = JSON.stringify(
        {
          name: 'opendork-nextjs-app',
          version: '0.1.0',
          private: true,
          scripts: {
            dev: 'next dev',
            build: 'next build',
            start: 'next start',
            lint: 'next lint',
          },
          dependencies: {
            next: '^15.0.0',
            react: '^19.0.0',
            'react-dom': '^19.0.0',
            'lucide-react': '^0.344.0',
            clsx: '^2.1.0',
            'tailwind-merge': '^2.2.1',
          },
          devDependencies: {
            typescript: '^5.0.0',
            '@types/node': '^20.0.0',
            '@types/react': '^19.0.0',
            '@types/react-dom': '^19.0.0',
            tailwindcss: '^3.4.1',
            postcss: '^8.4.35',
          },
        },
        null,
        2
      );
    } else {
      // Ensure 'next' dependency exists in existing package.json if invalid
      try {
        const pkg = JSON.parse(result['package.json']);
        if (!pkg.dependencies || !pkg.dependencies['next']) {
          pkg.dependencies = {
            next: '^15.0.0',
            react: '^19.0.0',
            'react-dom': '^19.0.0',
            'lucide-react': '^0.344.0',
            clsx: '^2.1.0',
            'tailwind-merge': '^2.2.1',
            ...(pkg.dependencies || {}),
          };
          result['package.json'] = JSON.stringify(pkg, null, 2);
        }
      } catch {
        // Leave as is
      }
    }

    // 2. app/layout.tsx
    const hasLayout = Object.keys(result).some((p) =>
      /^(\/)?app\/layout\.(tsx|jsx|js)$/i.test(p) || /^(\/)?pages\/_app\.(tsx|jsx|js)$/i.test(p)
    );
    if (!hasLayout) {
      result['app/layout.tsx'] = `import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Web Application',
  description: 'Built with Opendork AI',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-zinc-950 text-zinc-100 antialiased font-sans">
        {children}
      </body>
    </html>
  );
}
`;
    }

    // 3. app/globals.css
    const hasCss = Object.keys(result).some((p) =>
      /^(\/)?app\/globals\.css$/i.test(p) || /^(\/)?styles\/globals\.css$/i.test(p)
    );
    if (!hasCss) {
      result['app/globals.css'] = `@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --background: #09090b;
  --foreground: #fafafa;
}

body {
  color: var(--foreground);
  background: var(--background);
}
`;
    }

    // 4. lib/utils.ts
    const hasUtils = Object.keys(result).some((p) =>
      /^(\/)?(lib|src\/lib)\/utils\.(ts|js)$/i.test(p)
    );
    if (!hasUtils) {
      result['lib/utils.ts'] = `import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
`;
    }
  } else if (normalized === 'vite') {
    // 1. package.json
    if (!result['package.json'] && !result['/package.json']) {
      result['package.json'] = JSON.stringify(
        {
          name: 'opendork-vite-app',
          private: true,
          version: '0.0.0',
          type: 'module',
          scripts: {
            dev: 'vite',
            build: 'tsc && vite build',
            preview: 'vite preview',
          },
          dependencies: {
            react: '^18.3.1',
            'react-dom': '^18.3.1',
            'lucide-react': '^0.344.0',
            clsx: '^2.1.0',
            'tailwind-merge': '^2.2.1',
          },
          devDependencies: {
            '@types/react': '^18.3.3',
            '@types/react-dom': '^18.3.0',
            '@vitejs/plugin-react': '^4.3.0',
            typescript: '^5.2.2',
            vite: '^5.3.1',
            tailwindcss: '^3.4.1',
            postcss: '^8.4.35',
          },
        },
        null,
        2
      );
    }

    // 2. index.html
    if (!result['index.html'] && !result['/index.html']) {
      result['index.html'] = `<!doctype html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Web Application</title>
  </head>
  <body class="min-h-screen bg-zinc-950 text-zinc-100">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;
    }

    // 3. src/main.tsx
    if (!result['src/main.tsx'] && !result['src/main.jsx']) {
      result['src/main.tsx'] = `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`;
    }

    // 4. src/index.css
    if (!result['src/index.css'] && !result['src/App.css']) {
      result['src/index.css'] = `@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  margin: 0;
  background-color: #09090b;
  color: #fafafa;
}
`;
    }
  }

  return result;
}
