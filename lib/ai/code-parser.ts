/**
 * Incremental parser for extracting files from streaming markdown code blocks
 * Supports all LLM header styles: filename=..., {path=...}, path="...", file:..., and component deduction
 * Tracks the actively streaming file for live typewriter effect in Monaco editor
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
}

function resolveFilePath(header: string, content: string, fileIndex: number): string {
  let filePath: string | null = null;
  let language = 'typescript';

  // 1. Check language in header
  const langMatch = header.match(/^([A-Za-z0-9_-]+)/);
  if (langMatch) {
    language = langMatch[1].toLowerCase();
  }

  // 2. Extract path from header:
  // Format A: filename=app/page.tsx or path=app/page.tsx or file=app/page.tsx
  const pathMatch = header.match(/(?:filename|path|file)=["']?([^"'\s}]+)["']?/i);
  if (pathMatch) {
    filePath = pathMatch[1].trim();
  }

  // Format B: {path=components/Navbar.tsx}
  if (!filePath) {
    const braceMatch = header.match(/\{path=([^}]+)\}/i);
    if (braceMatch) {
      filePath = braceMatch[1].trim();
    }
  }

  // Format C: tsx:components/Navbar.tsx
  if (!filePath && header.includes(':')) {
    const colonParts = header.split(':');
    if (colonParts.length >= 2 && colonParts[1].includes('.')) {
      filePath = colonParts.slice(1).join(':').trim();
    }
  }

  // 3. Check first line of content for path indicators
  const lines = content.split('\n');
  const firstLine = (lines[0] || '').trim();

  if (!filePath) {
    const commentMatch = firstLine.match(/^\/\/\s*(?:filename:|path:|file:)?\s*([\w\-./]+\.[a-zA-Z0-9]+)/i);
    if (commentMatch && !commentMatch[1].startsWith('http')) {
      filePath = commentMatch[1].trim();
    }

    const firstLineBrace = firstLine.match(/^\{path=([^}]+)\}/i);
    if (firstLineBrace) {
      filePath = firstLineBrace[1].trim();
    }
  }

  // 4. Intelligent component inference based on code content
  if (!filePath) {
    if (content.includes('export default function RootLayout') || content.includes('function RootLayout(')) {
      filePath = 'app/layout.tsx';
    } else if (content.includes('export function cn(') || content.includes('twMerge(')) {
      filePath = 'lib/utils.ts';
    } else if (header.includes('json') || (content.trim().startsWith('{') && content.includes('"name":'))) {
      filePath = 'package.json';
    } else if (header.includes('css') || content.includes('@tailwind')) {
      filePath = 'app/globals.css';
    } else if (content.includes('function Navbar') || content.includes('const Navbar')) {
      filePath = 'components/Navbar.tsx';
    } else if (content.includes('function Hero') || content.includes('const Hero')) {
      filePath = 'components/Hero.tsx';
    } else if (content.includes('function Features') || content.includes('const Features')) {
      filePath = 'components/Features.tsx';
    } else if (content.includes('function Pricing') || content.includes('const Pricing')) {
      filePath = 'components/Pricing.tsx';
    } else if (content.includes('function Footer') || content.includes('const Footer')) {
      filePath = 'components/Footer.tsx';
    } else if (content.includes('export default function Home') || content.includes('function Home(') || content.includes('export default function Page')) {
      filePath = 'app/page.tsx';
    } else if (content.includes('function App(') || content.includes('export default function App')) {
      filePath = 'src/App.tsx';
    } else {
      const ext = language === 'tsx' || language === 'jsx' ? 'tsx' : 
                  language === 'css' ? 'css' : 
                  language === 'json' ? 'json' : 
                  language === 'html' ? 'html' : 'ts';
      filePath = `components/Component_${fileIndex}.${ext}`;
    }
  }

  // Clean up leading slashes and quotes
  return filePath.replace(/^\/+/, '').replace(/[\\'"]/g, '');
}

/**
 * Standard parser returning all complete and partial files
 */
export function parseFilesFromMarkdown(markdown: string): Record<string, string> {
  const { files } = extractStreamingState(markdown);
  return files;
}

/**
 * Advanced incremental parser that identifies the currently active file being written
 * and provides partial content for live typewriter effect
 */
export function extractStreamingState(markdown: string): StreamingParseResult {
  const files: Record<string, string> = {};
  if (!markdown) {
    return { files, currentStreamingFile: null, isComplete: false };
  }

  // Match all code fences: ```header\n...``` or unclosed ```header\n...$
  const fenceRegex = /```([^\n]*)\n([\s\S]*?)(?:```|$)/g;
  let match: RegExpExecArray | null;
  let fileIndex = 1;
  let lastFilePath: string | null = null;
  let lastIsUnclosed = false;

  while ((match = fenceRegex.exec(markdown)) !== null) {
    const header = (match[1] || '').trim();
    let content = match[2] || '';

    // Check if this fence was closed with ``` or ended at $ (unclosed/streaming)
    const matchedFullText = match[0];
    const isClosed = matchedFullText.endsWith('```');

    const filePath = resolveFilePath(header, content, fileIndex++);

    // If first line was a filename comment, strip it from content
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
    currentStreamingFile: lastFilePath,
    isComplete: !lastIsUnclosed,
  };
}
