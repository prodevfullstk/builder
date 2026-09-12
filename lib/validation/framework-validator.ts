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
