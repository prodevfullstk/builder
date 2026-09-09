'use client';

import { useEffect, useRef, useState } from 'react';
import { NodeboxAdapter, type FileSystem } from '@/lib/sandbox/nodebox-adapter';

export type Framework = 'nextjs' | 'astro' | 'vite' | 'node';

export type Status = 
  | 'initializing' 
  | 'mounting' 
  | 'installing' 
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
 * 
 * Runs fullstack frameworks in the browser using Nodebox
 * Supports: Next.js, Astro, Vite, Node.js
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
  
  // Update status and notify parent
  const updateStatus = (newStatus: Status) => {
    setStatus(newStatus);
    onStatusChange?.(newStatus);
  };
  
  // Add log message
  const addLog = (message: string) => {
    setLogs(prev => [...prev, message]);
    console.log(message);
  };
  
  // Handle error
  const handleError = (err: Error | string) => {
    const errorMessage = err instanceof Error ? err.message : err;
    setError(errorMessage);
    updateStatus('error');
    onError?.(errorMessage);
    addLog(`❌ Error: ${errorMessage}`);
  };
  
  useEffect(() => {
    if (!iframeRef.current) return;
    
    let mounted = true;
    
    async function initializeNodebox() {
      try {
        addLog('🚀 Starting Nodebox initialization...');
        
        // Create adapter
        const adapter = new NodeboxAdapter();
        adapterRef.current = adapter;
        
        // Initialize
        updateStatus('initializing');
        addLog('⚙️ Connecting to Nodebox runtime...');
        await adapter.initialize(iframeRef.current!);
        
        if (!mounted) return;
        addLog('✅ Nodebox connected');
        
        // Mount files
        updateStatus('mounting');
        addLog(`📁 Mounting ${Object.keys(files).length} files...`);
        await adapter.mountFiles(files);
        
        if (!mounted) return;
        addLog('✅ Files mounted');
        
        // Start server based on framework
        updateStatus('starting');
        let preview;
        
        switch (framework) {
          case 'nextjs':
            addLog('🚀 Starting Next.js dev server...');
            preview = await adapter.startNextJS();
            break;
          case 'astro':
            addLog('🚀 Starting Astro dev server...');
            preview = await adapter.startAstro();
            break;
          case 'vite':
            addLog('🚀 Starting Vite dev server...');
            preview = await adapter.startVite();
            break;
          case 'node':
            addLog(`🚀 Starting Node.js server: ${entry || 'index.js'}...`);
            preview = await adapter.startNode(entry || 'index.js');
            break;
          default:
            throw new Error(`Unknown framework: ${framework}`);
        }
        
        if (!mounted) return;
        
        // Set preview URL
        setPreviewUrl(preview.url);
        updateStatus('ready');
        onReady?.(preview.url);
        addLog(`✅ ${framework} is running at ${preview.url}`);
        
      } catch (err) {
        if (!mounted) return;
        handleError(err as Error);
      }
    }
    
    initializeNodebox();
    
    // Cleanup on unmount
    return () => {
      mounted = false;
      adapterRef.current?.cleanup();
    };
  }, [files, framework, entry]);
  
  const getStatusColor = () => {
    switch (status) {
      case 'ready':
        return 'bg-green-500';
      case 'error':
        return 'bg-red-500';
      default:
        return 'bg-yellow-500 animate-pulse';
    }
  };
  
  const getStatusText = () => {
    switch (status) {
      case 'initializing':
        return 'Initializing Nodebox...';
      case 'mounting':
        return 'Mounting files...';
      case 'installing':
        return 'Installing dependencies...';
      case 'starting':
        return `Starting ${framework}...`;
      case 'ready':
        return `${framework} running`;
      case 'error':
        return 'Error occurred';
    }
  };
  
  return (
    <div className="w-full h-full flex flex-col bg-zinc-950">
      {/* Status bar */}
      <div className="bg-zinc-900 border-b border-zinc-800 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${getStatusColor()}`} />
          <span className="text-sm text-zinc-400">
            {getStatusText()}
          </span>
        </div>
        
        {previewUrl && (
          <a 
            href={previewUrl} 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-xs text-azure-500 hover:text-azure-400 transition-colors"
          >
            Open in new tab ↗
          </a>
        )}
      </div>
      
      {/* Error message */}
      {error && (
        <div className="bg-red-500/10 border-b border-red-500/20 px-4 py-3">
          <p className="text-sm text-red-400 font-mono">{error}</p>
        </div>
      )}
      
      {/* Logs (collapsed by default, can be toggled) */}
      {logs.length > 0 && status !== 'ready' && (
        <div className="bg-zinc-900/50 border-b border-zinc-800 px-4 py-2 max-h-32 overflow-y-auto">
          {logs.map((log, i) => (
            <div key={i} className="text-xs text-zinc-500 font-mono">
              {log}
            </div>
          ))}
        </div>
      )}
      
      {/* Preview iframe */}
      <div className="flex-1 relative">
        {status !== 'ready' && (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-950">
            <div className="text-center space-y-3">
              <div className="w-12 h-12 border-4 border-azure-500 border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-sm text-zinc-400">{getStatusText()}</p>
            </div>
          </div>
        )}
        
        <iframe
          ref={iframeRef}
          id="nodebox-preview-iframe"
          className="w-full h-full border-none"
          sandbox="allow-scripts allow-same-origin allow-modals allow-forms allow-popups"
          allow="cross-origin-isolated"
        />
      </div>
    </div>
  );
}
