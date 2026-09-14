import { IntentContract } from '../ai/intent-contract';

export interface FileEntry {
  path: string;
  sizeBytes: number;
  extension: string;
}

export interface SymbolReference {
  name: string;
  kind: 'component' | 'function' | 'class' | 'hook' | 'variable';
  filePath: string;
  line: number;
}

export interface RetrievalContext {
  matchedFiles: string[];
  matchedSymbols: SymbolReference[];
  relatedFiles: string[];
  dependencyGraph: Record<string, string[]>;
  retrievedSnippets: Array<{ path: string; content: string; relevanceReason: string }>;
  tokenEstimate: number;
}

/**
 * Lists files deterministically from the workspace file map.
 */
export function listFiles(
  files: Record<string, string>,
  filter?: { extension?: string; prefix?: string; maxDepth?: number }
): FileEntry[] {
  const entries: FileEntry[] = [];

  for (const path of Object.keys(files).sort()) {
    const cleanPath = path.replace(/^\/+/, '');
    if (filter?.prefix && !cleanPath.startsWith(filter.prefix)) continue;

    const parts = cleanPath.split('/');
    if (filter?.maxDepth && parts.length > filter.maxDepth) continue;

    const ext = cleanPath.includes('.') ? cleanPath.split('.').pop() || '' : '';
    if (filter?.extension && ext.toLowerCase() !== filter.extension.toLowerCase()) continue;

    entries.push({
      path: cleanPath,
      sizeBytes: Buffer.byteLength(files[path] || '', 'utf-8'),
      extension: ext,
    });
  }

  return entries;
}

/**
 * Searches files by glob pattern or regex.
 */
export function searchFiles(files: Record<string, string>, pattern: string | RegExp): string[] {
  const regex = typeof pattern === 'string'
    ? new RegExp(pattern.replace(/\*/g, '.*'), 'i')
    : pattern;

  return Object.keys(files)
    .map((p) => p.replace(/^\/+/, ''))
    .filter((p) => regex.test(p))
    .sort();
}

/**
 * Searches text across all workspace files.
 */
export function searchText(
  files: Record<string, string>,
  query: string,
  options?: { caseSensitive?: boolean; maxMatches?: number }
): Array<{ path: string; lineNumber: number; lineContent: string }> {
  const matches: Array<{ path: string; lineNumber: number; lineContent: string }> = [];
  const max = options?.maxMatches || 50;
  const isCase = options?.caseSensitive || false;

  for (const [path, content] of Object.entries(files)) {
    if (typeof content !== 'string') continue;
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = isCase ? line.includes(query) : line.toLowerCase().includes(query.toLowerCase());
      if (match) {
        matches.push({
          path: path.replace(/^\/+/, ''),
          lineNumber: i + 1,
          lineContent: line.trim(),
        });
        if (matches.length >= max) return matches;
      }
    }
  }

  return matches;
}

/**
 * Finds symbols (components, functions, hooks) across the workspace files.
 */
export function findSymbols(files: Record<string, string>, symbolName?: string): SymbolReference[] {
  const symbols: SymbolReference[] = [];
  const symbolRegex = /(?:export\s+(?:default\s+)?)?(function|const|let|class)\s+([A-Za-z0-9_$]+)/g;

  for (const [path, content] of Object.entries(files)) {
    if (typeof content !== 'string') continue;
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let match: RegExpExecArray | null;
      symbolRegex.lastIndex = 0;
      while ((match = symbolRegex.exec(line)) !== null) {
        const kindRaw = match[1];
        const name = match[2];

        if (symbolName && name.toLowerCase() !== symbolName.toLowerCase()) continue;

        let kind: SymbolReference['kind'] = 'variable';
        if (name.startsWith('use')) kind = 'hook';
        else if (/^[A-Z]/.test(name)) kind = 'component';
        else if (kindRaw === 'function') kind = 'function';
        else if (kindRaw === 'class') kind = 'class';

        symbols.push({
          name,
          kind,
          filePath: path.replace(/^\/+/, ''),
          line: i + 1,
        });
      }
    }
  }

  return symbols;
}

/**
 * Inspects a specific file with optional line range.
 */
export function inspectFile(
  files: Record<string, string>,
  filePath: string,
  lineRange?: { startLine: number; endLine: number }
): string | null {
  const clean = filePath.replace(/^\/+/, '');
  const content = files[clean] || files[`/${clean}`];
  if (content === undefined) return null;

  if (!lineRange) return content;

  const lines = content.split(/\r?\n/);
  const start = Math.max(1, lineRange.startLine) - 1;
  const end = Math.min(lines.length, lineRange.endLine);
  return lines.slice(start, end).join('\n');
}

/**
 * Traces imported dependencies and references to identify related files.
 */
export function inspectRelatedFiles(files: Record<string, string>, targetPath: string): string[] {
  const cleanTarget = targetPath.replace(/^\/+/, '');
  const related = new Set<string>();

  const targetContent = files[cleanTarget] || files[`/${cleanTarget}`] || '';

  // 1. Trace outgoing imports from targetPath
  const importRegex = /(?:import|from)\s+['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(targetContent)) !== null) {
    const importSpec = match[1];
    if (importSpec.startsWith('.') || importSpec.startsWith('@/')) {
      const resolved = importSpec.replace(/^@\//, '').replace(/^\.\//, '');
      for (const p of Object.keys(files)) {
        const cleanP = p.replace(/^\/+/, '');
        if (cleanP.startsWith(resolved) || cleanP.includes(resolved)) {
          related.add(cleanP);
        }
      }
    }
  }

  // 2. Trace incoming references (who imports targetPath?)
  const baseTarget = cleanTarget.replace(/\.[^/.]+$/, '').split('/').pop() || '';
  for (const [path, content] of Object.entries(files)) {
    const cleanP = path.replace(/^\/+/, '');
    if (cleanP === cleanTarget) continue;
    if (content.includes(baseTarget) || content.includes(cleanTarget)) {
      related.add(cleanP);
    }
  }

  return Array.from(related).sort();
}

/**
 * Builds deterministic, auditable retrieval context based on intent and workspace state.
 * Implements: intent -> relevant files -> relevant symbols -> surrounding code -> dependencies -> context
 */
export function buildRetrievalContext(
  files: Record<string, string>,
  intent: IntentContract
): RetrievalContext {
  const matchedFilesSet = new Set<string>();
  const relatedFilesSet = new Set<string>();
  const dependencyGraph: Record<string, string[]> = {};
  const retrievedSnippets: Array<{ path: string; content: string; relevanceReason: string }> = [];

  const targetTokens = [
    ...(intent.targetFiles || []),
    ...intent.targetDescription.toLowerCase().split(/\s+/).filter((t) => t.length > 2),
  ];

  // 1. Locate directly matching files
  for (const path of Object.keys(files)) {
    const cleanPath = path.replace(/^\/+/, '');
    const lowerPath = cleanPath.toLowerCase();

    const isDirectTarget = intent.targetFiles?.includes(cleanPath);
    const matchesToken = targetTokens.some((token) => lowerPath.includes(token.toLowerCase()));

    if (isDirectTarget || matchesToken) {
      matchedFilesSet.add(cleanPath);
    }
  }

  // Special heuristics for common targets (e.g. navbar, logo, menu, header, footer)
  if (intent.targetDescription.toLowerCase().includes('logo') || intent.targetDescription.toLowerCase().includes('navbar')) {
    for (const p of Object.keys(files)) {
      const clean = p.replace(/^\/+/, '');
      if (/navbar|header|logo|nav/i.test(clean)) {
        matchedFilesSet.add(clean);
      }
    }
  }

  if (intent.targetDescription.toLowerCase().includes('menu') || intent.targetDescription.toLowerCase().includes('hamburger')) {
    for (const p of Object.keys(files)) {
      const clean = p.replace(/^\/+/, '');
      if (/navbar|menu|header|nav|layout/i.test(clean)) {
        matchedFilesSet.add(clean);
      }
    }
  }

  // Fallback: If no files matched, add active or entry files
  if (matchedFilesSet.size === 0) {
    if (files['app/page.tsx']) matchedFilesSet.add('app/page.tsx');
    else if (files['src/App.tsx']) matchedFilesSet.add('src/App.tsx');
    else if (files['src/pages/index.astro']) matchedFilesSet.add('src/pages/index.astro');
  }

  // 2. Discover related files & dependencies
  for (const primaryFile of matchedFilesSet) {
    const deps = inspectRelatedFiles(files, primaryFile);
    dependencyGraph[primaryFile] = deps;
    for (const dep of deps) {
      relatedFilesSet.add(dep);
    }
  }

  // 3. Extract symbols
  const allSymbols = findSymbols(files);
  const matchedSymbols = allSymbols.filter((s) =>
    matchedFilesSet.has(s.filePath) ||
    targetTokens.some((t) => s.name.toLowerCase().includes(t.toLowerCase()))
  );

  // 4. Assemble bounded snippets
  const allConsidered = [...Array.from(matchedFilesSet), ...Array.from(relatedFilesSet)].slice(0, 10);
  let totalChars = 0;

  for (const path of allConsidered) {
    const content = files[path] || files[`/${path}`] || '';
    const isDirect = matchedFilesSet.has(path);
    const maxSlice = isDirect ? 4000 : 1500;
    const snippet = content.slice(0, maxSlice);
    totalChars += snippet.length;

    retrievedSnippets.push({
      path,
      content: snippet,
      relevanceReason: isDirect ? 'Direct intent target match' : 'Dependency / related file reference',
    });
  }

  return {
    matchedFiles: Array.from(matchedFilesSet).sort(),
    matchedSymbols,
    relatedFiles: Array.from(relatedFilesSet).sort(),
    dependencyGraph,
    retrievedSnippets,
    tokenEstimate: Math.round(totalChars / 4),
  };
}
