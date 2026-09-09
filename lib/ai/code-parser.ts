/**
 * Incremental parser for extracting files from streaming markdown code blocks
 */

export interface ParsedFile {
  path: string;
  language: string;
  content: string;
}

export function parseFilesFromMarkdown(markdown: string): Record<string, string> {
  const files: Record<string, string> = {};
  if (!markdown) return files;

  // Match code fences: ```lang [filename=path] \n content \n ```
  // Also matches unclosed code fences at the end of streaming
  const fenceRegex = /```([^\n]*)\n([\s\S]*?)(?:```|$)/g;
  let match: RegExpExecArray | null;

  let fileIndex = 1;

  while ((match = fenceRegex.exec(markdown)) !== null) {
    const header = (match[1] || '').trim();
    let content = match[2] || '';

    // Extract path from header: filename=app/page.tsx or path=app/page.tsx or {filename=...}
    let filePath: string | null = null;
    let language = 'typescript';

    const pathMatch = header.match(/(?:filename|path)=([^\s}]+)/i);
    if (pathMatch) {
      filePath = pathMatch[1].replace(/['"]/g, '');
    }

    const langMatch = header.match(/^([A-Za-z0-9_-]+)/);
    if (langMatch) {
      language = langMatch[1].toLowerCase();
    }

    // Check if the first line of content contains {path=...} or filename=...
    if (!filePath) {
      const lines = content.split('\n');
      const firstLine = (lines[0] || '').trim();
      const firstLineMatch = firstLine.match(/^[/*#\s]*\{?(?:filename|path)=([^\s}]+)\}?[/*\s]*$/i);
      if (firstLineMatch) {
        filePath = firstLineMatch[1].replace(/['"]/g, '');
        content = lines.slice(1).join('\n');
      }
    }

    // Fallback path inference based on language / content if no explicit path
    if (!filePath) {
      if (content.includes('export default function RootLayout') || content.includes('<html>')) {
        filePath = 'app/layout.tsx';
      } else if (content.includes('export default function') || content.includes('function App(')) {
        filePath = 'app/page.tsx';
      } else if (header.includes('json') || content.trim().startsWith('{') && content.includes('"name":')) {
        filePath = 'package.json';
      } else if (header.includes('css') || content.includes('@tailwind')) {
        filePath = 'app/globals.css';
      } else {
        const ext = language === 'tsx' || language === 'jsx' ? 'tsx' : 
                    language === 'css' ? 'css' : 
                    language === 'json' ? 'json' : 
                    language === 'html' ? 'html' : 'ts';
        filePath = `file_${fileIndex++}.${ext}`;
      }
    }

    // Clean up leading/trailing slashes
    filePath = filePath.replace(/^\/+/, '');
    files[filePath] = content;
  }

  return files;
}
