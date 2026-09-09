'use client';

import { useEffect, useRef, useState } from 'react';
import { NodeboxAdapter, type FileSystem, type Framework } from '@/lib/sandbox/nodebox-adapter';

export type { Framework };

export type Status = 
  | 'initializing' 
  | 'mounting' 
  | 'starting' 
  | 'ready' 
  | 'error';

interface NodeboxPreviewProps {
  files: FileSystem;
  framework: Framework;
  entry?: string;
  onStatusChange?: (status: Status) => void;
  onError?: (error: string) => void;
  onReady?: (previewUrl: string) => void;
}

/**
 * Nodebox Preview Component
 * Runs fullstack frameworks in the browser using CodeSandbox Nodebox
 */
export function NodeboxPreview({ 
  files, 
  framework, 
  entry,
  onStatusChange,
  onError,
  onReady
}: NodeboxPreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const adapterRef = useRef<NodeboxAdapter | null>(null);
  
  const [status, setStatus] = useState<Status>('initializing');
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  
  const updateStatus = (newStatus: Status) => {
    setStatus(newStatus);
    onStatusChange?.(newStatus);
  };
  
  const addLog = (message: string) => {
    setLogs(prev => [...prev.slice(-100), message]);
    console.log(message);
  };
  
  const handleError = (err: Error | string) => {
    const errorMessage = err instanceof Error ? err.message : String(err);
    setError(errorMessage);
    updateStatus('error');
    onError?.(errorMessage);
    addLog(`❌ Error: ${errorMessage}`);
  };
  
  useEffect(() => {
    let mounted = true;
    
    async function initializeNodebox() {
      try {
        setError(null);
        addLog('🚀 Starting Nodebox initialization...');
        
        const adapter = new NodeboxAdapter();
        adapterRef.current = adapter;
        adapter.setLogCallback((msg) => {
          if (mounted) addLog(msg);
        });
        
        updateStatus('initializing');
        await adapter.initialize();
        
        if (!mounted) return;
        
        updateStatus('mounting');
        await adapter.mountFiles(files);
        
        if (!mounted) return;
        
        updateStatus('starting');
        const preview = await adapter.startFramework(framework, undefined, entry);
        
        if (!mounted) return;
        
        setPreviewUrl(preview.url);
        updateStatus('ready');
        onReady?.(preview.url);
        
      } catch (err: any) {
        if (!mounted) return;
        handleError(err);
      }
    }
    
    initializeNodebox();
    
    return () => {
      mounted = false;
      adapterRef.current?.cleanup();
    };
  }, [files, framework, entry]);
  
  const getStatusColor = () => {
    switch (status) {
      case 'ready':
        return 'bg-emerald-500';
      case 'error':
        return 'bg-red-500';
      default:
        return 'bg-blue-500 animate-pulse';
    }
  };
  
  const getStatusText = () => {
    switch (status) {
      case 'initializing':
        return 'Connecting to Nodebox runtime...';
      case 'mounting':
        return 'Mounting project files...';
      case 'starting':
        return `Starting ${framework.toUpperCase()} server...`;
      case 'ready':
        return `${framework.toUpperCase()} running live`;
      case 'error':
        return 'Failed to start server';
    }
  };
  
  return (
    <div className="w-full h-full flex flex-col bg-zinc-950">
      {/* Status Bar */}
      <div className="bg-zinc-900 border-b border-zinc-800 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${getStatusColor()}`} />
          <span className="text-xs font-mono text-zinc-300">
            {getStatusText()}
          </span>
        </div>
        
        {previewUrl && (
          <a 
            href={previewUrl} 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
          >
            Open in new tab ↗
          </a>
        )}
      </div>
      
      {/* Error Banner */}
      {error && (
        <div className="bg-red-500/10 border-b border-red-500/20 px-4 py-3">
          <p className="text-xs text-red-400 font-mono">{error}</p>
        </div>
      )}
      
      {/* Logs preview when booting */}
      {logs.length > 0 && status !== 'ready' && (
        <div className="bg-zinc-900/80 border-b border-zinc-800 px-4 py-2 max-h-32 overflow-y-auto font-mono text-[11px] text-zinc-400 space-y-0.5">
          {logs.map((log, i) => (
            <div key={i} className={log.includes('❌') ? 'text-red-400' : log.includes('✅') ? 'text-emerald-400' : ''}>
              {log}
            </div>
          ))}
        </div>
      )}
      
      {/* Preview Area */}
      <div className="flex-1 relative bg-white">
        {status !== 'ready' && (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-950 z-10">
            <div className="text-center space-y-3">
              <div className="w-10 h-10 border-3 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-xs font-mono text-zinc-400">{getStatusText()}</p>
            </div>
          </div>
        )}
        
        {previewUrl ? (
          <iframe
            ref={iframeRef}
            src={previewUrl}
            title="Nodebox Preview"
            className="w-full h-full border-none"
            sandbox="allow-scripts allow-same-origin allow-modals allow-forms allow-popups"
            allow="cross-origin-isolated"
          />
        ) : null}
      </div>
    </div>
  );
}
