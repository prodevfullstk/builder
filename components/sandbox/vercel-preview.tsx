'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Loader2, ExternalLink, RefreshCw, AlertCircle, Cloud, CheckCircle2 } from 'lucide-react';

export type SandboxStatus = 'initializing' | 'mounting' | 'starting' | 'ready' | 'error';

interface VercelPreviewProps {
  files: Record<string, string>;
  projectId?: string;
  framework?: string;
  refreshNonce?: number;
  onStatusChange?: (status: SandboxStatus) => void;
  onError?: (error: string) => void;
  onReady?: (previewUrl: string) => void;
  onLog?: (message: string) => void;
}

export function VercelPreview({
  files,
  projectId = 'default',
  framework = 'nextjs',
  refreshNonce = 0,
  onStatusChange,
  onError,
  onReady,
  onLog,
}: VercelPreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<SandboxStatus>('initializing');
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const isMountedRef = useRef(true);

  const addLog = (msg: string) => {
    setLogs((prev) => [...prev.slice(-40), msg]);
    onLog?.(msg);
  };

  const updateStatus = (newStatus: SandboxStatus) => {
    setStatus(newStatus);
    onStatusChange?.(newStatus);
  };

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const initSandbox = async () => {
    if (!files || Object.keys(files).length === 0) {
      updateStatus('initializing');
      return;
    }

    try {
      setError(null);
      updateStatus('initializing');
      addLog('☁️ Connecting to Vercel Sandbox MicroVM...');

      updateStatus('mounting');
      addLog(`📦 Synchronizing ${Object.keys(files).length} project files...`);

      const res = await fetch('/api/sandbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'start',
          projectId,
          files,
          framework,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}: Failed to start Vercel Sandbox`);
      }

      const data = await res.json();
      if (!isMountedRef.current) return;

      if (!data.success || !data.previewUrl) {
        throw new Error(data.error || 'No preview URL returned from Vercel Sandbox');
      }

      updateStatus('starting');
      addLog(`🚀 Dev server ready on port 3000. Route: ${data.previewUrl}`);

      setPreviewUrl(data.previewUrl);
      updateStatus('ready');
      onReady?.(data.previewUrl);
      addLog(`✅ Live Preview active: ${data.previewUrl}`);
    } catch (err: any) {
      if (!isMountedRef.current) return;
      const errMsg = err?.message || 'Error running in Vercel Sandbox';
      setError(errMsg);
      updateStatus('error');
      onError?.(errMsg);
      addLog(`❌ Sandbox Error: ${errMsg}`);
    }
  };

  useEffect(() => {
    initSandbox();
  }, [refreshNonce, Object.keys(files).length, projectId]);

  if (!files || Object.keys(files).length === 0) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-zinc-950 text-zinc-500 text-sm font-mono p-4 text-center">
        <Cloud className="w-8 h-8 text-zinc-600 mb-2 animate-pulse" />
        <p>No project files to preview in Vercel Sandbox</p>
        <p className="text-xs text-zinc-600 mt-1">Prompt the AI or add files to launch cloud preview</p>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col bg-zinc-950 relative overflow-hidden">
      {/* Sandbox Status Bar */}
      <div className="h-8 px-3 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between text-xs font-mono">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            {status === 'ready' ? (
              <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/50" />
            ) : status === 'error' ? (
              <span className="w-2 h-2 rounded-full bg-red-500" />
            ) : (
              <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" />
            )}
            <span className="text-[11px] text-zinc-300 capitalize">
              {status === 'ready'
                ? 'Vercel Sandbox: Live'
                : status === 'mounting'
                ? 'Syncing MicroVM files...'
                : status === 'starting'
                ? 'Starting server...'
                : status === 'error'
                ? 'Execution failed'
                : 'Initializing Vercel Sandbox...'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {previewUrl && (
            <a
              href={previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300 transition-colors"
            >
              <span>{previewUrl.replace('https://', '')}</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
          <button
            onClick={initSandbox}
            className="p-1 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors"
            title="Restart Sandbox"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="p-3 bg-red-500/10 border-b border-red-500/20 text-red-400 text-xs flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="flex-1 font-mono text-[11px]">{error}</div>
        </div>
      )}

      {/* MicroVM Booting State Overlay */}
      {status !== 'ready' && !error && (
        <div className="absolute inset-0 bg-zinc-950/90 backdrop-blur-xs flex flex-col items-center justify-center p-6 z-20 text-center">
          <div className="p-3 rounded-full bg-zinc-900 border border-zinc-800 mb-3 shadow-lg">
            <Cloud className="w-7 h-7 text-blue-400 animate-pulse" />
          </div>
          <h4 className="text-sm font-medium text-zinc-200 mb-1">
            Running in Vercel Cloud MicroVM
          </h4>
          <p className="text-xs text-zinc-400 max-w-xs mb-4">
            Isolating files and binding port 3000 on Vercel Sandbox...
          </p>

          <div className="w-64 max-h-24 overflow-hidden rounded bg-zinc-900/90 border border-zinc-800 p-2 text-left font-mono text-[10px] text-zinc-400 space-y-1">
            {logs.slice(-3).map((l, i) => (
              <div key={i} className="truncate">
                {l}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Live Preview Iframe */}
      {previewUrl && (
        <iframe
          ref={iframeRef}
          src={previewUrl}
          title="Vercel Sandbox Live Preview"
          className="w-full flex-1 border-none bg-white"
          sandbox="allow-scripts allow-same-origin allow-modals allow-forms allow-popups"
          allow="cross-origin-isolated; fullscreen"
        />
      )}
    </div>
  );
}
