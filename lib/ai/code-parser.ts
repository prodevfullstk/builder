/**
 * Incremental parser for extracting files and patches from streaming AI responses.
 * Supports:
 *   1. Streaming: markdown code fences (```filename=...) for live typewriter
 *   2. Completion: <FILES>{...}</FILES> JSON block for reliable structured extraction
 *   3. Patches: <PATCHES>[...]</PATCHES> structured patch format
 *
 * Implements strict status reporting: 'parsed' | 'malformed' | 'partial' | 'unsupported'.
 * Disallows synthetic fallback filenames (generated/file_N.ext) during targeted modifications.
 */

import { CandidatePatchItem, StructuredPatchSet } from '../patch/patch-model';

export type ParseStatus = 'parsed' | 'malformed' | 'partial' | 'unsupported';

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
  status: ParseStatus;
}

export interface FinalParseResult {
  files: Record<string, string>;
  patches?: CandidatePatchItem[];
  aiExplanation: string | null;
  parseError: boolean;
  status: ParseStatus;
  diagnostics: string[];
}

// ─── Structured JSON parser (<FILES> block) ────────────────────────────────

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

export function parseStructuredOutput(text: string): {
  files: Record<string, string> | null;
  parseError: boolean;
  status: ParseStatus;
} {
  const filesBlockMatch = text.match(/<FILES>\s*([\s\S]*?)\s*<\/FILES>/);
  if (!filesBlockMatch) {
    // Check if there was an unclosed <FILES> block (partial stream)
    if (text.includes('<FILES>')) {
      return { files: null, parseError: true, status: 'partial' };
    }
    return { files: null, parseError: false, status: 'unsupported' };
  }

  let rawBlock = filesBlockMatch[1].trim();

  // 1. Strip markdown fences if AI wrapped content in ```json ... ``` inside <FILES>
  if (rawBlock.startsWith('```')) {
    rawBlock = rawBlock.replace(/^```[a-zA-Z]*\n?/, '').replace(/```\s*$/, '').trim();
  }

  // 2. Extract strictly from the outermost JSON object braces { ... }
  const firstBrace = rawBlock.indexOf('{');
  const lastBrace = rawBlock.lastIndexOf('}');
  const boundedJson = (firstBrace !== -1 && lastBrace > firstBrace)
    ? rawBlock.slice(firstBrace, lastBrace + 1)
    : rawBlock;

  const tryParse = (src: string): Record<string, string> | null => {
    try {
      const json = JSON.parse(src);
      if (!json.files || !Array.isArray(json.files)) return null;
      const files: Record<string, string> = {};
      for (const item of json.files) {
        if (item.path && typeof item.content === 'string') {
          files[item.path.replace(/^\/+/, '')] = item.content;
        }
      }
      return Object.keys(files).length > 0 ? files : null;
    } catch {
      return null;
    }
  };

  // Attempt 1: direct parse of bounded json
  let res = tryParse(boundedJson);
  if (res) return { files: res, parseError: false, status: 'parsed' };

  // Attempt 2: sanitize then parse bounded json
  res = tryParse(sanitizeFilesJSON(boundedJson));
  if (res) {
    return { files: res, parseError: false, status: 'parsed' };
  }

  // Attempt 3: Regex item-by-item extraction fallback if full JSON has minor trailing syntax issue
  try {
    const itemRegex = /\{\s*"path"\s*:\s*"([^"]+)"\s*,\s*"content"\s*:\s*"((?:\\.|[^"\\])*)"\s*\}/g;
    let match: RegExpExecArray | null;
    const fallbackFiles: Record<string, string> = {};
    while ((match = itemRegex.exec(boundedJson)) !== null) {
      const path = match[1].replace(/^\/+/, '');
      try {
        const content = JSON.parse(`"${match[2]}"`);
        fallbackFiles[path] = content;
      } catch {
        fallbackFiles[path] = match[2].replace(/\\n/g, '\n').replace(/\\"/g, '"');
      }
    }
    if (Object.keys(fallbackFiles).length > 0) {
      return { files: fallbackFiles, parseError: false, status: 'parsed' };
    }
  } catch (e3) {
    console.error('[Parser] <FILES> regex fallback failed:', String(e3).slice(0, 200));
  }

  return { files: null, parseError: true, status: 'malformed' };
}

/**
 * Parses <PATCHES>[...]</PATCHES> JSON block from completed AI responses.
 */
export function parseStructuredPatches(text: string): {
  patches: CandidatePatchItem[] | null;
  parseError: boolean;
  status: ParseStatus;
} {
  const patchBlockMatch = text.match(/<PATCHES>\s*([\s\S]*?)\s*<\/PATCHES>/);
  if (!patchBlockMatch) {
    if (text.includes('<PATCHES>')) {
      return { patches: null, parseError: true, status: 'partial' };
    }
    return { patches: null, parseError: false, status: 'unsupported' };
  }

  try {
    const json = JSON.parse(patchBlockMatch[1].trim());
    const patchArray = Array.isArray(json) ? json : json.patches;
    if (!Array.isArray(patchArray)) {
      return { patches: null, parseError: true, status: 'malformed' };
    }
    return { patches: patchArray, parseError: false, status: 'parsed' };
  } catch {
    return { patches: null, parseError: true, status: 'malformed' };
  }
}

/**
 * Extracts the AI explanation text that comes after the </FILES> or </PATCHES> block.
 */
export function parseAIExplanation(text: string): string | null {
  const afterFiles = text.split('</FILES>')[1] || text.split('</PATCHES>')[1];
  if (!afterFiles) return null;
  const trimmed = afterFiles.trim();
  return trimmed.length > 10 ? trimmed : null;
}

// ─── Streaming markdown fence parser ─────────────────────────────────────

function resolveFilePath(
  header: string,
  content: string,
  fileIndex: number,
  allowSynthetic = true
): string | null {
  let filePath: string | null = null;
  let language = 'typescript';

  // 1. Language from header
  const langMatch = header.match(/^([A-Za-z0-9_-]+)/);
  if (langMatch) language = langMatch[1].toLowerCase();

  // 2. Path from header: filename=, path=, file=
  const pathMatch = header.match(/(?:filename|path|file)=["']?([^"'\s}]+)["']?/i);
  if (pathMatch) filePath = pathMatch[1].trim();

  // 2b. Space-separated path: ```tsx app/page.tsx or ```json package.json
  if (!filePath) {
    const spaceMatch = header.match(/^[A-Za-z0-9_-]+\s+([a-zA-Z0-9_./-]+\.[a-zA-Z0-9]{1,6})/);
    if (spaceMatch) filePath = spaceMatch[1].trim();
  }

  // 3. {path=...} brace format
  if (!filePath) {
    const braceMatch = header.match(/\{path=([^}]+)\}/i);
    if (braceMatch) filePath = braceMatch[1].trim();
  }

  // 4. tsx:components/Navbar.tsx colon format — must look like a real path
  if (!filePath && header.includes(':')) {
    const colonParts = header.split(':');
    const candidate = colonParts.slice(1).join(':').trim();
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

  // 6. Last resort — synthetic filename (disallowed for targeted modifications)
  if (!filePath) {
    if (!allowSynthetic) return null;
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
 */
export function extractStreamingState(markdown: string): StreamingParseResult {
  const files: Record<string, string> = {};
  if (!markdown) return { files, currentStreamingFile: null, isComplete: false, aiExplanation: null, status: 'unsupported' };

  // Strip content after <FILES> or <PATCHES> for streaming parse
  const textForStreaming = markdown.split('<FILES>')[0].split('<PATCHES>')[0];

  const fenceRegex = /```([^\n]*)\n([\s\S]*?)(?:```|$)/g;
  let match: RegExpExecArray | null;
  let fileIndex = 1;
  let lastFilePath: string | null = null;
  let lastIsUnclosed = false;

  while ((match = fenceRegex.exec(textForStreaming)) !== null) {
    const header = (match[1] || '').trim();
    let content = match[2] || '';
    const isClosed = match[0].endsWith('```');

    const firstLine = (content.split('\n')[0] || '').trim();
    const hasFirstLinePath = /^\/\/\s*(?:filename:|path:|file:)?\s*[\w\-./]+\.[a-zA-Z0-9]+/i.test(firstLine);
    const hasFilename = /(?:filename|path|file)=/i.test(header) || header.includes(':') || hasFirstLinePath;
    if (!hasFilename && !isClosed) continue;

    const filePath = resolveFilePath(header, content, fileIndex++, true);
    if (!filePath) continue;

    // Strip first-line filename comment from content
    const lines = content.split('\n');
    if (lines[0] && lines[0].match(/^\/\/\s*(?:filename:|path:|file:)?\s*[\w\-./]+\.[a-zA-Z0-9]+/i)) {
      content = lines.slice(1).join('\n');
    }

    files[filePath] = content;
    lastFilePath = filePath;
    lastIsUnclosed = !isClosed;
  }

  const isComplete = !lastIsUnclosed;
  const status: ParseStatus = Object.keys(files).length > 0 ? (isComplete ? 'parsed' : 'partial') : 'unsupported';

  return {
    files,
    currentStreamingFile: lastIsUnclosed ? lastFilePath : null,
    isComplete,
    aiExplanation: null,
    status,
  };
}

/**
 * Unwraps raw SSE chunks if raw stream text was passed instead of decoded delta.
 */
export function unwrapSSEText(raw: string): string {
  if (!raw || (!raw.includes('data: ') && !raw.includes('event: '))) {
    return raw;
  }
  let unwrapped = '';
  const lines = raw.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('data: ')) {
      const dataStr = trimmed.slice(6).trim();
      if (!dataStr || dataStr === '[DONE]') continue;
      try {
        const json = JSON.parse(dataStr);
        if (typeof json.delta === 'string') unwrapped += json.delta;
        else if (typeof json.content === 'string') unwrapped += json.content;
      } catch {
        // Not JSON
      }
    }
  }
  return unwrapped.trim() ? unwrapped : raw;
}

/**
 * Extracts files emitted via <TOOL_CALL> blocks (e.g. write_file)
 */
export function extractToolCallFiles(text: string): Record<string, string> {
  const files: Record<string, string> = {};
  if (!text.includes('<TOOL_CALL>')) return files;

  const regex = /<TOOL_CALL>\s*([\s\S]*?)\s*<\/TOOL_CALL>/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const rawJson = match[1].trim();
    const tryParse = (src: string) => {
      try {
        const parsed = JSON.parse(src);
        if (parsed.name === 'write_file' && parsed.args?.path && typeof parsed.args?.content === 'string') {
          const cleanPath = String(parsed.args.path).replace(/^\/+/, '');
          if (cleanPath) files[cleanPath] = parsed.args.content;
        }
      } catch {}
    };
    tryParse(rawJson);
    if (Object.keys(files).length === 0) {
      const sanitized = rawJson
        .replace(/\r\n/g, '\\n')
        .replace(/(?<!\\)\n/g, '\\n')
        .replace(/(?<!\\)\t/g, '\\t');
      tryParse(sanitized);
    }
  }
  return files;
}

/**
 * Final parse — called when streaming completes.
 * Priority order:
 *   1. <PATCHES> block (if present)
 *   2. <FILES> JSON block (if present)
 *   3. <TOOL_CALL> write_file blocks
 *   4. Markdown fences (fallback)
 * Returns explicit parse status: 'parsed' | 'malformed' | 'partial' | 'unsupported'.
 * For targeted modifications (forTargetedModification = true), synthetic filenames are rejected.
 */
export function parseFinalOutput(
  rawText: string,
  options?: { forTargetedModification?: boolean }
): FinalParseResult {
  const fullText = unwrapSSEText(rawText);
  const aiExplanation = parseAIExplanation(fullText);
  const diagnostics: string[] = [];
  const forTargeted = options?.forTargetedModification || false;

  // 1. Try structured Patches first
  if (fullText.includes('<PATCHES>')) {
    const { patches, parseError, status } = parseStructuredPatches(fullText);
    if (status === 'parsed' && patches) {
      return {
        files: {},
        patches,
        aiExplanation,
        parseError: false,
        status: 'parsed',
        diagnostics: [],
      };
    }
    if (parseError) {
      return {
        files: {},
        aiExplanation,
        parseError: true,
        status,
        diagnostics: ['Malformed <PATCHES> block in response.'],
      };
    }
  }

  // 2. Extract files from <FILES> structured JSON
  let structuredFiles: Record<string, string> = {};
  let structuredStatus: ParseStatus = 'unsupported';
  if (fullText.includes('<FILES>')) {
    const { files, parseError, status } = parseStructuredOutput(fullText);
    structuredStatus = status;
    if (status === 'parsed' && files && Object.keys(files).length > 0) {
      structuredFiles = files;
    } else if (parseError) {
      diagnostics.push('Malformed or incomplete <FILES> structured block.');
    }
  }

  // 3. Extract files from <TOOL_CALL> write_file blocks
  const toolCallFiles = extractToolCallFiles(fullText);

  // 4. Extract files from markdown code fences
  const { files: markdownFiles, isComplete, status: mdStatus } = extractStreamingState(fullText);

  // Merge all discovered files (priority: structured > toolCall > markdown)
  const combinedFiles: Record<string, string> = {
    ...markdownFiles,
    ...toolCallFiles,
    ...structuredFiles,
  };

  // Check for forbidden synthetic filenames during targeted modifications
  const syntheticFiles = Object.keys(combinedFiles).filter((p) => p.startsWith('generated/file_'));
  if (forTargeted && syntheticFiles.length > 0) {
    for (const syn of syntheticFiles) {
      delete combinedFiles[syn];
    }
    return {
      files: combinedFiles,
      aiExplanation,
      parseError: true,
      status: 'unsupported',
      diagnostics: [
        `Synthetic filenames (${syntheticFiles.join(', ')}) are strictly prohibited for targeted modifications.`,
      ],
    };
  }

  const hasFiles = Object.keys(combinedFiles).length > 0;
  if (!isComplete && !hasFiles) {
    diagnostics.push('AI stream ended with unclosed markdown code fence.');
  }

  let finalStatus: ParseStatus = 'unsupported';
  if (hasFiles) {
    finalStatus = (isComplete || Object.keys(structuredFiles).length > 0 || Object.keys(toolCallFiles).length > 0) ? 'parsed' : 'partial';
  } else if (structuredStatus === 'malformed') {
    finalStatus = 'malformed';
  } else if (structuredStatus === 'partial' || !isComplete) {
    finalStatus = 'partial';
  }

  return {
    files: combinedFiles,
    aiExplanation,
    parseError: !hasFiles,
    status: finalStatus,
    diagnostics,
  };
}

// Legacy export for backward compatibility
export function parseFilesFromMarkdown(markdown: string): Record<string, string> {
  const { files } = parseFinalOutput(markdown);
  return files;
}
