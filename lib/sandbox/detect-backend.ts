/**
 * Backend detection utility - no Nodebox dependency
 * Extracts detectBackendEntry to avoid cuid SSR crash
 */

export function detectBackendEntry(files: Record<string, string>): string | null {
  const backendCandidates = [
    'server.js',
    'server.cjs',
    'server.mjs',
    'api/server.js',
    'api/index.js',
    'backend/server.js',
    'backend/index.js',
    'src/server.js'
  ];

  for (const candidate of backendCandidates) {
    if (files[candidate] || files['/' + candidate]) {
      return candidate;
    }
  }

  // Also check if any .js file mentions http.createServer or express
  for (const [path, content] of Object.entries(files)) {
    if (
      path.endsWith('.js') &&
      (content.includes('http.createServer') ||
       content.includes('express()') ||
       content.includes('.listen('))
    ) {
      return path.replace(/^\/+/, '');
    }
  }

  return null;
}
