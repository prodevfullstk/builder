'use client';

import React, { useEffect, useState, useMemo, useRef } from 'react';
import { generateInstantPreviewHtml } from '@/lib/preview/instant-preview-html';
import { bundleProjectWithEsbuild } from '@/lib/preview/esbuild-compiler';

interface InstantPreviewProps {
  files: Record<string, string>;
  className?: string;
  refreshNonce?: number;
  backendUrl?: string | null;
  currentRoute?: string;
  onError?: (err: string) => void;
  onScreenshot?: (dataUrl: string) => void;
  onEngineStatusChange?: (status: 'simulated-dom' | 'virtual-compiled') => void;
}

export function InstantPreview({
  files,
  className = '',
  refreshNonce = 0,
  backendUrl = null,
  currentRoute = '/',
  onError,
  onScreenshot,
  onEngineStatusChange,
}: InstantPreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Listen to preview iframe runtime/compilation errors + screenshots with strict source validation
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Source window validation: reject messages not originating from this preview iframe
      if (iframeRef.current && event.source !== iframeRef.current.contentWindow) {
        return;
      }
      if (!event.data || typeof event.data !== 'object') {
        return;
      }
      if (event.data.type === 'preview-error' && typeof event.data.error === 'string') {
        onError?.(event.data.error.slice(0, 1000));
      }
      if (
        event.data.type === 'preview-screenshot' &&
        typeof event.data.dataUrl === 'string' &&
        event.data.dataUrl.startsWith('data:image/')
      ) {
        onScreenshot?.(event.data.dataUrl);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onError, onScreenshot]);
  // 1. Babel HTML renders immediately (sync) - always reliable
  const babelHtml = useMemo(() => {
    if (!files || Object.keys(files).length === 0) return '';
    return generateInstantPreviewHtml(files, currentRoute);
  }, [files, refreshNonce, currentRoute]);

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
          onEngineStatusChange?.('virtual-compiled');
        } else if (!cancelled && result.errors.length > 0) {
          onEngineStatusChange?.('simulated-dom');
          onError?.(`Virtual build error: ${result.errors[0]}`);
        }
      } catch (err: any) {
        if (!cancelled) {
          onEngineStatusChange?.('simulated-dom');
          onError?.(`Virtual build error: ${err?.message || 'compilation error'}`);
        }
      }
    }

    // Reset esbuild html when files change
    setEsbuildHtml('');
    onEngineStatusChange?.('simulated-dom');
    tryEsbuild();

    return () => { cancelled = true; };
  }, [files, refreshNonce, backendUrl, onError, onEngineStatusChange]);

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
      ref={iframeRef}
      key={`${refreshNonce}-${esbuildHtml ? 'esbuild' : 'babel'}`}
      srcDoc={htmlContent}
      title="Instant App Preview"
      className={`w-full h-full border-none bg-white ${className}`}
      sandbox="allow-scripts allow-modals allow-forms allow-popups"
    />
  );
}

