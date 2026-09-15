/**
 * Route Detector Utility
 * Parses project files to discover all navigable website routes (/home, /shop, /about, /pricing, etc.)
 * Supports Next.js App Router, Pages Router, Astro, and Vite React Router.
 */

export interface DetectedRoute {
  path: string;
  label: string;
  file?: string;
  isDefault?: boolean;
}

/**
 * Scan virtual project files to extract all defined routes
 */
export function detectProjectRoutes(files: Record<string, string> = {}): DetectedRoute[] {
  const routes: DetectedRoute[] = [];
  const seenPaths = new Set<string>();

  // Helper to register a route
  const addRoute = (path: string, label: string, file?: string, isDefault = false) => {
    // Normalize path: ensure leading slash, remove trailing slash (except root)
    let cleanPath = path.startsWith('/') ? path : '/' + path;
    if (cleanPath.length > 1 && cleanPath.endsWith('/')) {
      cleanPath = cleanPath.slice(0, -1);
    }

    if (!seenPaths.has(cleanPath)) {
      seenPaths.add(cleanPath);
      routes.push({
        path: cleanPath,
        label: formatRouteLabel(label || cleanPath),
        file,
        isDefault,
      });
    }
  };

  // Always register root Home route
  addRoute('/', 'Home', undefined, true);

  if (!files || typeof files !== 'object') {
    return routes;
  }

  // 1. Next.js App Router: app/**/page.tsx
  for (const [rawPath] of Object.entries(files)) {
    const normalized = rawPath.replace(/\\/g, '/').replace(/^(\.\/|\/)/, '');
    
    // Match app/.../page.tsx or src/app/.../page.tsx
    const appMatch = normalized.match(/^(?:src\/)?app\/(.+)\/page\.(?:tsx|jsx|js|ts)$/);
    if (appMatch) {
      const rawSegments = appMatch[1].split('/');
      // Filter out route groups like (marketing), (auth) and parallel routes @modal
      const segments = rawSegments.filter(s => !s.startsWith('(') && !s.startsWith('@'));
      if (segments.length > 0) {
        const routePath = '/' + segments.join('/');
        const lastSeg = segments[segments.length - 1];
        addRoute(routePath, lastSeg, rawPath);
      }
    }
  }

  // 2. Next.js Pages Router: pages/*.tsx
  for (const [rawPath] of Object.entries(files)) {
    const normalized = rawPath.replace(/\\/g, '/').replace(/^(\.\/|\/)/, '');
    const pagesMatch = normalized.match(/^(?:src\/)?pages\/(.+)\.(?:tsx|jsx|js|ts|astro)$/);
    if (pagesMatch) {
      const name = pagesMatch[1];
      if (name !== 'index' && name !== '_app' && name !== '_document' && !name.startsWith('api/')) {
        addRoute('/' + name, name, rawPath);
      }
    }
  }

  // 3. Scan code content for React Router <Route path="..." /> or { path: '...' }
  for (const [rawPath, content] of Object.entries(files)) {
    if (typeof content !== 'string') continue;

    // JSX <Route path="/shop" ... />
    const jsxRouteRegex = /<Route\s+[^>]*path=["']([^"']+)["']/g;
    let m;
    while ((m = jsxRouteRegex.exec(content)) !== null) {
      const r = m[1];
      if (r && r.startsWith('/') && !r.includes('*') && !r.includes(':')) {
        const label = r === '/' ? 'Home' : r.slice(1);
        addRoute(r, label, rawPath);
      }
    }

    // Config array { path: '/shop' }
    const objRouteRegex = /path\s*:\s*["'](\/[a-zA-Z0-9_\-\/]+)["']/g;
    while ((m = objRouteRegex.exec(content)) !== null) {
      const r = m[1];
      if (r && !r.includes('*') && !r.includes(':')) {
        const label = r === '/' ? 'Home' : r.slice(1);
        addRoute(r, label, rawPath);
      }
    }
  }

  // 4. Scan dedicated page components (src/pages/*.tsx or components/pages/*.tsx)
  for (const [rawPath] of Object.entries(files)) {
    const normalized = rawPath.replace(/\\/g, '/').replace(/^(\.\/|\/)/, '');
    const pageFileMatch = normalized.match(/^(?:src\/)?(?:components\/)?pages\/([A-Z][a-zA-Z0-9_\-]+)\.(?:tsx|jsx)$/);
    if (pageFileMatch) {
      const compName = pageFileMatch[1];
      if (compName.toLowerCase() !== 'home' && compName.toLowerCase() !== 'index') {
        const routePath = '/' + compName.toLowerCase();
        addRoute(routePath, compName, rawPath);
      }
    }
  }

  return routes;
}

/**
 * Format raw path segment into clean, readable title
 */
function formatRouteLabel(raw: string): string {
  if (raw === '/' || raw.toLowerCase() === 'home') return 'Home';
  const clean = raw.replace(/^\/+/, '').replace(/-/g, ' ');
  return clean
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
