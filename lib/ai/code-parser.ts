/**
 * Incremental parser for extracting files from streaming AI responses.
 * Supports two extraction modes:
 *   1. Streaming: markdown code fences (```filename=...) for live typewriter
 *   2. Completion: <FILES>{...}</FILES> JSON block for reliable final extraction
 */

export interface ParsedFile {
  path: string;
  language: string;
  content: string;
}

export interface StreamingParseResult {
  files: Record<string, string>;
  currentStreamingFile: string | null;
  isComplete: boolean;
  aiExplanation: string | null;
}

// ─── Structured JSON parser (<FILES> block) ────────────────────────────────

/**
 * Parses the reliable <FILES>...</FILES> JSON block from completed AI responses.
 * This is the primary extraction method — more accurate than markdown fence parsing.
 */
/**
 * Attempt to sanitize the JSON block content when initial parse fails.
 * Handles common AI mistakes: unescaped newlines inside string values.
 */
function sanitizeFilesJSON(raw: string): string {
  return raw
    .replace(/\r\n/g, '\\n')
    .replace(/(?<!\\)\n/g, '\\n')
    .replace(/(?<!\\)\t/g, '\\t');
}

export function parseStructuredOutput(text: string): { files: Record<string, string> | null; parseError: boolean } {
  const filesBlockMatch = text.match(/<FILES>\s*([\s\S]*?)\s*<\/FILES>/);
  if (!filesBlockMatch) return { files: null, parseError: false };

  const rawBlock = filesBlockMatch[1].trim();

  const tryParse = (src: string): Record<string, string> | null => {
    const json = JSON.parse(src);
    if (!json.files || !Array.isArray(json.files)) return null;
    const files: Record<string, string> = {};
    for (const item of json.files) {
      if (item.path && typeof item.content === 'string') {
        files[item.path.replace(/^\/+/, '')] = item.content;
      }
    }
    return Object.keys(files).length > 0 ? files : null;
  };

  // Attempt 1: direct parse
  try {
    return { files: tryParse(rawBlock), parseError: false };
  } catch { /* fall through */ }

  // Attempt 2: sanitize then parse
  try {
    const files = tryParse(sanitizeFilesJSON(rawBlock));
    console.warn('[Parser] <FILES> JSON required sanitization');
    return { files, parseError: false };
  } catch (e2) {
    console.error('[Parser] <FILES> JSON parse failed after sanitization:', String(e2).slice(0, 200));
    console.error('[Parser] Failed block (first 300 chars):', rawBlock.slice(0, 300));
    return { files: null, parseError: true };
  }
}


/**
 * Extracts the AI explanation text that comes after the </FILES> block.
 */
export function parseAIExplanation(text: string): string | null {
  const afterFiles = text.split('</FILES>')[1];
  if (!afterFiles) return null;
  const trimmed = afterFiles.trim();
  return trimmed.length > 10 ? trimmed : null;
}

// ─── Streaming markdown fence parser ─────────────────────────────────────

function resolveFilePath(header: string, content: string, fileIndex: number): string {
  let filePath: string | null = null;
  let language = 'typescript';

  // 1. Language from header
  const langMatch = header.match(/^([A-Za-z0-9_-]+)/);
  if (langMatch) language = langMatch[1].toLowerCase();

  // 2. Path from header: filename=, path=, file=
  const pathMatch = header.match(/(?:filename|path|file)=["']?([^"'\s}]+)["']?/i);
  if (pathMatch) filePath = pathMatch[1].trim();

  // 3. {path=...} brace format
  if (!filePath) {
    const braceMatch = header.match(/\{path=([^}]+)\}/i);
    if (braceMatch) filePath = braceMatch[1].trim();
  }

  // 4. tsx:components/Navbar.tsx colon format — must look like a real path
  if (!filePath && header.includes(':')) {
    const colonParts = header.split(':');
    const candidate = colonParts.slice(1).join(':').trim();
    // Must be a clean file path: word chars + slashes + dots, no spaces, braces, or brackets
    if (/^[\w\-./]+\.[a-zA-Z0-9]{1,6}$/.test(candidate)) {
      filePath = candidate;
    }
  }

  // 5. First-line comment: // filename: app/page.tsx
  if (!filePath) {
    const firstLine = (content.split('\n')[0] || '').trim();
    const commentMatch = firstLine.match(/^\/\/\s*(?:filename:|path:|file:)?\s*([\w\-./]+\.[a-zA-Z0-9]+)/i);
    if (commentMatch && !commentMatch[1].startsWith('http')) {
      filePath = commentMatch[1].trim();
    }
  }

  // 6. Last resort — deterministic fallback using language extension
  if (!filePath) {
    const ext = language === 'tsx' || language === 'jsx' ? 'tsx'
               : language === 'ts' ? 'ts'
               : language === 'css' ? 'css'
               : language === 'json' ? 'json'
               : language === 'html' ? 'html'
               : language === 'sql' ? 'sql'
               : language === 'js' || language === 'javascript' ? 'js'
               : 'ts';
    filePath = `generated/file_${fileIndex}.${ext}`;
  }

  return filePath.replace(/^\/+/, '').replace(/[\\'"]/g, '');
}

/**
 * Incremental streaming parser — used while AI is still streaming.
 * Detects which file is currently being typed for live typewriter effect.
 */
export function extractStreamingState(markdown: string): StreamingParseResult {
  const files: Record<string, string> = {};
  if (!markdown) return { files, currentStreamingFile: null, isComplete: false, aiExplanation: null };

  // Strip content after <FILES> for streaming parse (avoid double-counting)
  const textForStreaming = markdown.split('<FILES>')[0];

  const fenceRegex = /```([^\n]*)\n([\s\S]*?)(?:```|$)/g;
  let match: RegExpExecArray | null;
  let fileIndex = 1;
  let lastFilePath: string | null = null;
  let lastIsUnclosed = false;

  while ((match = fenceRegex.exec(textForStreaming)) !== null) {
    const header = (match[1] || '').trim();
    let content = match[2] || '';
    const isClosed = match[0].endsWith('```');

    // Skip fences without a filename in streaming mode if they look like explanations
    const hasFilename = /(?:filename|path|file)=/i.test(header) || header.includes(':');
    if (!hasFilename && !isClosed) continue; // Skip unclosed fences without filename

    const filePath = resolveFilePath(header, content, fileIndex++);

    // Strip first-line filename comment from content
    const lines = content.split('\n');
    if (lines[0] && lines[0].match(/^\/\/\s*(?:filename:|path:|file:)?\s*[\w\-./]+\.[a-zA-Z0-9]+/i)) {
      content = lines.slice(1).join('\n');
    }

    files[filePath] = content;
    lastFilePath = filePath;
    lastIsUnclosed = !isClosed;
  }

  return {
    files,
    currentStreamingFile: lastIsUnclosed ? lastFilePath : null,
    isComplete: !lastIsUnclosed,
    aiExplanation: null,
  };
}

/**
 * Final parse — called when streaming completes.
 * Prefers <FILES> JSON block; falls back to markdown fence parsing.
 * Returns parseError=true if <FILES> block was present but JSON was invalid.
 */
export function parseFinalOutput(fullText: string): {
  files: Record<string, string>;
  aiExplanation: string | null;
  parseError: boolean;
} {
  const aiExplanation = parseAIExplanation(fullText);

  // Try structured JSON first (reliable)
  const { files: structuredFiles, parseError } = parseStructuredOutput(fullText);

  if (structuredFiles && Object.keys(structuredFiles).length > 0) {
    return { files: structuredFiles, aiExplanation, parseError: false };
  }

  // If <FILES> block existed but failed to parse, log it
  if (parseError) {
    console.warn('[Parser] <FILES> block present but unparseable — falling back to markdown fences');
  }

  // Fallback to markdown fence parsing
  const { files } = extractStreamingState(fullText);
  return { files, aiExplanation, parseError };
}

// Legacy export for backward compatibility
export function parseFilesFromMarkdown(markdown: string): Record<string, string> {
  const { files } = parseFinalOutput(markdown);
  return files;
}

