'use client';

import React, { useEffect, useState } from 'react';
import { bundleProjectWithEsbuild } from '@/lib/preview/esbuild-compiler';
import { generateInstantPreviewHtml } from '@/lib/preview/instant-preview-html';

interface InstantPreviewProps {
  files: Record<string, string>;
  className?: string;
  refreshNonce?: number;
  backendUrl?: string | null;
}

export function InstantPreview({
  files,
  className = '',
  refreshNonce = 0,
  backendUrl = null,
}: InstantPreviewProps) {
  const [htmlContent, setHtmlContent] = useState<string>('');
  const [isCompiling, setIsCompiling] = useState<boolean>(false);
  const [compileError, setCompileError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!files || Object.keys(files).length === 0) {
      setHtmlContent('');
      return;
    }

    async function compile() {
      setIsCompiling(true);
      setCompileError(null);

      try {
        // 1. Primary: In-browser esbuild-wasm bundling (~50ms)
        const result = await bundleProjectWithEsbuild(files, backendUrl || undefined);
        if (cancelled) return;

        if (result.errors.length === 0 && result.html) {
          setHtmlContent(result.html);
          setIsCompiling(false);
          return;
        }

        console.warn('[Preview] esbuild reported warnings/errors, attempting Babel fallback:', result.errors);
      } catch (err: any) {
        console.warn('[Preview] esbuild error, attempting Babel fallback:', err);
      }

      // 2. Secondary Fallback: In-browser Babel standalone compiler
      if (cancelled) return;
      try {
        const fallbackHtml = generateInstantPreviewHtml(files);
        setHtmlContent(fallbackHtml);
      } catch (err: any) {
        setCompileError(err?.message || 'Failed to compile preview');
      } finally {
        if (!cancelled) setIsCompiling(false);
      }
    }

    compile();

    return () => {
      cancelled = true;
    };
  }, [files, refreshNonce, backendUrl]);

  if (!files || Object.keys(files).length === 0) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-zinc-950 text-zinc-500 text-sm font-mono p-4 text-center">
        <p>No project files to preview</p>
        <p className="text-xs text-zinc-600 mt-1">Prompt the AI or add files to see live preview</p>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full">
      {isCompiling && !htmlContent && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-zinc-950/80 backdrop-blur-xs text-zinc-400 font-mono text-xs">
          <div className="flex items-center gap-2">
            <div className="w-3.5 h-3.5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <span>Compiling preview (esbuild)...</span>
          </div>
        </div>
      )}

      {compileError && !htmlContent && (
        <div className="p-4 m-4 bg-red-950/50 border border-red-800 rounded-lg text-red-300 font-mono text-xs">
          <p className="font-bold mb-1">Preview Build Error:</p>
          <pre className="whitespace-pre-wrap">{compileError}</pre>
        </div>
      )}

      {htmlContent && (
        <iframe
          key={refreshNonce}
          srcDoc={htmlContent}
          title="Instant App Preview"
          className={`w-full h-full border-none bg-white ${className}`}
          sandbox="allow-scripts allow-same-origin allow-modals allow-forms allow-popups"
        />
      )}
    </div>
  );
}
