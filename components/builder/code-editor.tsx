'use client';

import React, { Component, ErrorInfo, ReactNode, useEffect, useRef } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import { useProjectStore } from '@/lib/store/project-store';
import { FileCode, AlertCircle, Copy, Check } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallbackFile?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMsg: string;
}

class MonacoErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorMsg: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, errorMsg: error.message };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.warn('Monaco Editor error caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-zinc-950 text-zinc-400">
          <AlertCircle className="w-8 h-8 text-amber-500 mb-2" />
          <p className="text-sm font-semibold text-zinc-200">Editor reloaded</p>
          <p className="text-xs text-zinc-500 mb-4">{this.state.errorMsg}</p>
          <button
            onClick={() => this.setState({ hasError: false, errorMsg: '' })}
            className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs rounded-md"
          >
            Refresh Editor
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function CodeEditor() {
  const { files, activeFile, updateFile } = useProjectStore();
  const editorRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = React.useState(false);

  const currentContent = files[activeFile] ?? '';

  const getLanguageFromPath = (path: string): string => {
    if (path.endsWith('.tsx') || path.endsWith('.jsx')) return 'typescript';
    if (path.endsWith('.ts') || path.endsWith('.js') || path.endsWith('.mjs')) return 'javascript';
    if (path.endsWith('.json')) return 'json';
    if (path.endsWith('.css')) return 'css';
    if (path.endsWith('.html')) return 'html';
    return 'plaintext';
  };

  const handleEditorMount: OnMount = (editor) => {
    editorRef.current = editor;

    // Resilient ResizeObserver
    if (containerRef.current && typeof ResizeObserver !== 'undefined') {
      let isDisposed = false;
      editor.onDidDispose(() => {
        isDisposed = true;
      });

      const observer = new ResizeObserver(() => {
        if (!isDisposed && editor.getDomNode()) {
          editor.layout();
        }
      });
      observer.observe(containerRef.current);
    }
  };

  const handleCopyCode = () => {
    if (currentContent) {
      navigator.clipboard.writeText(currentContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div ref={containerRef} className="flex-1 h-full flex flex-col bg-zinc-950 overflow-hidden">
      {/* Editor Tab Bar */}
      <div className="h-9 px-3 border-b border-zinc-800 bg-zinc-900/80 flex items-center justify-between select-none">
        <div className="flex items-center gap-2">
          <FileCode className="w-3.5 h-3.5 text-blue-400" />
          <span className="text-xs font-mono font-medium text-zinc-200 truncate">
            {activeFile || 'No file selected'}
          </span>
        </div>

        <button
          onClick={handleCopyCode}
          className="flex items-center gap-1 px-2 py-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 text-[11px] transition-colors"
          title="Copy file contents"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-emerald-400" />
              <span className="text-emerald-400">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>

      {/* Editor Body */}
      <div className="flex-1 w-full relative">
        <MonacoErrorBoundary fallbackFile={activeFile}>
          <Editor
            height="100%"
            language={getLanguageFromPath(activeFile)}
            value={currentContent}
            theme="vs-dark"
            onChange={(val) => {
              if (activeFile && val !== undefined) {
                updateFile(activeFile, val);
              }
            }}
            onMount={handleEditorMount}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              tabSize: 2,
              wordWrap: 'on',
              scrollBeyondLastLine: false,
              automaticLayout: false,
              padding: { top: 12, bottom: 12 },
              lineNumbers: 'on',
              renderLineHighlight: 'all',
            }}
          />
        </MonacoErrorBoundary>
      </div>
    </div>
  );
}
