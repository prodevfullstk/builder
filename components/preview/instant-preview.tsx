'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { generateInstantPreviewHtml } from '@/lib/preview/instant-preview-html';
import { bundleProjectWithEsbuild } from '@/lib/preview/esbuild-compiler';

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
  // 1. Babel HTML renders immediately (sync) - always reliable
  const babelHtml = useMemo(() => {
    if (!files || Object.keys(files).length === 0) return '';
    return generateInstantPreviewHtml(files);
  }, [files, refreshNonce]);

  // 2. esbuild HTML upgrades async in background (better quality)
  const [esbuildHtml, setEsbuildHtml] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    if (!files || Object.keys(files).length === 0) return;

    async function tryEsbuild() {
      try {
        const result = await bundleProjectWithEsbuild(files, backendUrl || undefined);
        if (!cancelled && result.errors.length === 0 && result.html) {
          setEsbuildHtml(result.html);
        }
      } catch {
        // esbuild failed - Babel fallback already showing, no action needed
      }
    }

    // Reset esbuild html when files change
    setEsbuildHtml('');
    tryEsbuild();

    return () => { cancelled = true; };
  }, [files, refreshNonce, backendUrl]);

  // Use esbuild result if available, otherwise use reliable Babel result
  const htmlContent = esbuildHtml || babelHtml;

  if (!files || Object.keys(files).length === 0) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-zinc-950 text-zinc-500 text-sm font-mono p-4 text-center">
        <p>No project files to preview</p>
        <p className="text-xs text-zinc-600 mt-1">Prompt the AI or add files to see live preview</p>
      </div>
    );
  }

  return (
    <iframe
      key={`${refreshNonce}-${esbuildHtml ? 'esbuild' : 'babel'}`}
      srcDoc={htmlContent}
      title="Instant App Preview"
      className={`w-full h-full border-none bg-white ${className}`}
      sandbox="allow-scripts allow-same-origin allow-modals allow-forms allow-popups"
    />
  );
}

