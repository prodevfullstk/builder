'use client';

import React, { useMemo } from 'react';
import { generateInstantPreviewHtml } from '@/lib/preview/instant-preview-html';

interface InstantPreviewProps {
  files: Record<string, string>;
  className?: string;
  refreshNonce?: number;
}

export function InstantPreview({ files, className = '', refreshNonce = 0 }: InstantPreviewProps) {
  // Generate the standalone HTML bundle
  const htmlContent = useMemo(() => {
    if (!files || Object.keys(files).length === 0) {
      return '';
    }
    return generateInstantPreviewHtml(files);
  }, [files, refreshNonce]);

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
      key={refreshNonce}
      srcDoc={htmlContent}
      title="Instant App Preview"
      className={`w-full h-full border-none bg-white ${className}`}
      sandbox="allow-scripts allow-same-origin allow-modals allow-forms allow-popups"
    />
  );
}
