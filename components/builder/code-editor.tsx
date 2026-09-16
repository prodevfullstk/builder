'use client';

import React, { Component, ErrorInfo, ReactNode, useEffect, useRef } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import { useProjectStore } from '@/lib/store/project-store';
import { evaluateCandidateChanges } from '@/lib/validation/candidate-pipeline';
import { StreamEventDecoder } from '@/lib/ai/stream-events';
import { useAuthStore, getClientAuthHeaders } from '@/lib/auth/supabase-auth';
import { FileCode, AlertCircle, Copy, Check, FilePlus, Sparkles, Send, X, Loader2 } from 'lucide-react';

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

interface CodeEditorProps {
  onRequestNewFile?: () => void;
}

export function CodeEditor({ onRequestNewFile }: CodeEditorProps) {
  const { files, setFiles, activeFile, updateFile, isStreaming, streamingFile, requestCreateFile, framework, dbProvider, authProvider, projectId, addLog } = useProjectStore();
  const editorRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = React.useState(false);
  const [isSaved, setIsSaved] = React.useState(true);
  const [showSaveToast, setShowSaveToast] = React.useState(false);
  const [aiBarOpen, setAiBarOpen] = React.useState(false);
  const [aiPrompt, setAiPrompt] = React.useState('');
  const [aiLoading, setAiLoading] = React.useState(false);
  const [aiError, setAiError] = React.useState<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aiInputRef = useRef<HTMLInputElement>(null);

  // Use prop if provided, otherwise fall back to store action
  const handleNewFile = onRequestNewFile ?? requestCreateFile;

  // Show editor for any open file, even if content is empty (blank new file)
  const currentContent = activeFile ? (files[activeFile] ?? '') : '';

  // Reset saved state when switching files
  useEffect(() => {
    setIsSaved(true);
    setAiBarOpen(false);
    setAiPrompt('');
    setAiError(null);
  }, [activeFile]);

  // Auto-focus AI input when bar opens
  useEffect(() => {
    if (aiBarOpen) setTimeout(() => aiInputRef.current?.focus(), 50);
  }, [aiBarOpen]);

  // Auto-scroll Monaco editor to bottom as code streams in real-time
  useEffect(() => {
    if (!isStreaming || !editorRef.current) return;
    const editor = editorRef.current;
    try {
      const model = editor.getModel?.();
      if (!model || model.isDisposed?.()) return;
      const lineCount = model.getLineCount?.() || 1;
      editor.revealLine?.(lineCount);
      const scrollHeight = editor.getScrollHeight?.();
      if (typeof scrollHeight === 'number') {
        editor.setScrollTop?.(scrollHeight);
      }
    } catch {
      // Ignored if model disposed
    }
  }, [currentContent, activeFile, isStreaming]);

  const getLanguageFromPath = (path: string): string => {
    if (path.endsWith('.tsx') || path.endsWith('.jsx')) return 'typescript';
    if (path.endsWith('.ts') || path.endsWith('.js') || path.endsWith('.mjs')) return 'javascript';
    if (path.endsWith('.json')) return 'json';
    if (path.endsWith('.css')) return 'css';
    if (path.endsWith('.html')) return 'html';
    return 'plaintext';
  };

  const triggerSaveToast = () => {
    setIsSaved(true);
    setShowSaveToast(true);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setShowSaveToast(false), 2000);
  };

  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;

    // Ctrl+S / Cmd+S → show "Auto-saved" toast
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      triggerSaveToast();
    });

    // Resilient ResizeObserver
    if (containerRef.current && typeof ResizeObserver !== 'undefined') {
      let isDisposed = false;
      editor.onDidDispose(() => { isDisposed = true; });
      const observer = new ResizeObserver(() => {
        if (!isDisposed && editor.getDomNode()) editor.layout();
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

  const handleAskAI = async () => {
    if (!aiPrompt.trim() || !activeFile || aiLoading) return;

    const authState = useAuthStore.getState();
    if (!authState.isAuthenticated || !authState.accessToken) {
      setAiError('Please sign in to edit code with AI.');
      authState.setAuthModalOpen(true);
      return;
    }

    setAiLoading(true);
    setAiError(null);
    // CONC-501: Capture baseline revision before starting asynchronous AI edit
    const baselineRevision = useProjectStore.getState().revision || 1;

    try {
      const response = await fetch('/api/agent', {
        method: 'POST',
        headers: await getClientAuthHeaders(),
        body: JSON.stringify({
          message: aiPrompt.trim(),
          activeFile,
          files: { ...files, [activeFile]: currentContent },
          framework,
          dbProvider,
          authProvider,
          mode: 'edit',
        }),
      });
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);

      const reader = response.body.getReader();
      const textDecoder = new TextDecoder();
      const sseDecoder = new StreamEventDecoder();
      let rawStreamResult = '';
      const proposedFiles: Record<string, string> = {};

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = textDecoder.decode(value, { stream: true });
        rawStreamResult += chunk;

        const events = sseDecoder.pushChunk(chunk);
        for (const ev of events) {
          if (ev.type === 'file_delta' && ev.path) {
            proposedFiles[ev.path] = (proposedFiles[ev.path] || '') + ev.delta;
          }
        }
      }

      // If proposedFiles was not fully populated via SSE, parse from <FILES> block or raw response
      if (Object.keys(proposedFiles).length === 0) {
        const filesMatch = rawStreamResult.match(/<FILES>\s*([\s\S]*?)\s*<\/FILES>/);
        if (filesMatch) {
          try {
            const json = JSON.parse(filesMatch[1].trim());
            if (Array.isArray(json.files)) {
              for (const f of json.files) {
                if (f.path && typeof f.content === 'string') {
                  proposedFiles[f.path] = f.content;
                }
              }
            }
          } catch {
            proposedFiles[activeFile] = rawStreamResult.split('<FILES>')[0].trim();
          }
        } else {
          const cleaned = rawStreamResult.replace(/<FILES>[\s\S]*<\/FILES>/g, '').replace(/event: [^\n]+\ndata: [^\n]+\n\n/g, '').trim();
          if (cleaned.length > 20) {
            proposedFiles[activeFile] = cleaned;
          }
        }
      }

      if (Object.keys(proposedFiles).length === 0) {
        setAiError('AI did not produce valid replacement code.');
        return;
      }

      const candidateFiles = { ...files, ...proposedFiles };

      // Candidate Validation Gate (Security, framework contract, secrets, minimal scope)
      addLog(`[Monaco AI Edit] Validating candidate changes across ${Object.keys(proposedFiles).length} file(s)...`);
      const evalResult = await evaluateCandidateChanges({
        projectId: projectId || 'workspace',
        framework,
        currentFiles: files,
        candidateFiles,
        isNewBuild: false,
        baselineRevision,
      });

      if (!evalResult.accepted) {
        const errorMsg = evalResult.diagnostics[0] || 'AI edit violated framework or security validation.';
        setAiError(errorMsg);
        addLog(`[Monaco AI Edit Rejected] ${evalResult.diagnostics.join(' | ')}`);
        return;
      }

      // Concurrency Gate (CONC-501): Check workspace revision freshness before committing edit
      const currentRevision = useProjectStore.getState().revision || 1;
      if (currentRevision !== baselineRevision) {
        setAiError('Conflict: Workspace files changed while this edit was generating. The edit was aborted.');
        addLog(`[Monaco AI Edit Conflict] Stale edit rejected: Workspace revision changed from ${baselineRevision} to ${currentRevision}.`);
        return;
      }

      // Gate 6: Centralized Server-Authoritative CAS Commit Boundary
      // No direct client mutation occurs before the server-authoritative commit succeeds
      const commitResponse = await fetch('/api/validate/candidate', {
        method: 'POST',
        headers: await getClientAuthHeaders(),
        body: JSON.stringify({
          projectId: projectId || 'workspace',
          expectedRevision: baselineRevision,
          candidateFiles,
          candidateHash: evalResult.evidence.candidateHash,
          validationEvidence: evalResult.evidence,
        }),
      });

      const commitResult = await commitResponse.json().catch(() => ({}));
      if (!commitResponse.ok || !commitResult.success) {
        const errorMsg = commitResult.error || `Commit rejected: HTTP ${commitResponse.status}`;
        setAiError(errorMsg);
        addLog(`[Monaco AI Edit CAS Rejected] ${errorMsg}`);
        return;
      }

      // Authoritative State Refresh: Update workspace files and monotonic revision from commit result
      if (commitResult.project?.files) {
        setFiles(commitResult.project.files);
      } else {
        for (const [fPath, fContent] of Object.entries(proposedFiles)) {
          updateFile(fPath, fContent);
        }
      }

      setAiPrompt('');
      setAiBarOpen(false);
      setAiError(null);
      addLog(`[Monaco AI Edit CAS Committed] ✓ Atomically updated ${Object.keys(proposedFiles).length} file(s) to revision ${commitResult.revision || (baselineRevision + 1)}.`);
    } catch (err: any) {
      console.error('AI edit failed:', err);
      setAiError(err?.message || 'AI edit request failed.');
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div ref={containerRef} className="flex-1 h-full flex flex-col bg-zinc-950 overflow-hidden relative">
      {/* Editor Tab Bar */}
      <div className="h-9 px-3 border-b border-zinc-800 bg-zinc-900/80 flex items-center justify-between select-none shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <FileCode className="w-3.5 h-3.5 text-blue-400 shrink-0" />
          {/* Unsaved indicator dot */}
          {activeFile && !isSaved && !isStreaming && (
            <span className="w-1.5 h-1.5 rounded-full bg-orange-400 shrink-0" title="Unsaved changes" />
          )}
          <span className="text-xs font-mono font-medium text-zinc-200 truncate">
            {activeFile || 'No file selected'}
          </span>
          {isStreaming && streamingFile === activeFile && (
            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-blue-500/15 border border-blue-500/30 text-[10px] text-blue-400 font-sans shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-ping" />
              <span>Streaming code...</span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {/* Ask AI button */}
          {activeFile && (
            <button
              onClick={() => setAiBarOpen((v) => !v)}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] transition-colors ${
                aiBarOpen
                  ? 'bg-violet-600/20 text-violet-300 border border-violet-500/30'
                  : 'text-zinc-400 hover:text-violet-300 hover:bg-zinc-800'
              }`}
              title="Ask AI to modify this file"
            >
              <Sparkles className="w-3 h-3" />
              <span>Ask AI</span>
            </button>
          )}
          {/* New File button in tab bar */}
          {handleNewFile && (
            <button
              onClick={handleNewFile}
              className="flex items-center gap-1 px-2 py-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 text-[11px] transition-colors"
              title="New File"
            >
              <FilePlus className="w-3 h-3" />
              <span>New File</span>
            </button>
          )}
          <button
            onClick={handleCopyCode}
            disabled={!currentContent}
            className="flex items-center gap-1 px-2 py-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 text-[11px] transition-colors disabled:opacity-30"
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
      </div>

      {/* AI Prompt Bar — slides in below tab bar */}
      {aiBarOpen && activeFile && (
        <div className="shrink-0 flex flex-col bg-zinc-900 border-b border-violet-500/30">
          <div className="flex items-center gap-2 px-3 py-2">
            <Sparkles className="w-3.5 h-3.5 text-violet-400 shrink-0" />
            <input
              ref={aiInputRef}
              value={aiPrompt}
              onChange={(e) => {
                setAiPrompt(e.target.value);
                if (aiError) setAiError(null);
              }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAskAI(); if (e.key === 'Escape') setAiBarOpen(false); }}
              placeholder={`Ask AI to modify ${activeFile.split('/').pop()}...`}
              className="flex-1 bg-transparent text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none font-mono"
              disabled={aiLoading}
            />
            {aiLoading ? (
              <Loader2 className="w-3.5 h-3.5 text-violet-400 animate-spin shrink-0" />
            ) : (
              <button
                onClick={handleAskAI}
                disabled={!aiPrompt.trim()}
                className="p-1 text-violet-400 hover:text-violet-200 disabled:opacity-30 transition-colors shrink-0"
                title="Send to AI"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            )}
            <button onClick={() => setAiBarOpen(false)} className="p-1 text-zinc-600 hover:text-zinc-400 shrink-0">
              <X className="w-3 h-3" />
            </button>
          </div>
          {aiError && (
            <div className="px-3 py-1 bg-red-500/15 border-t border-red-500/30 text-[11px] text-red-300 font-mono flex items-center gap-1.5">
              <AlertCircle className="w-3 h-3 text-red-400 shrink-0" />
              <span className="truncate">{aiError}</span>
            </div>
          )}
        </div>
      )}

      {/* Editor Body */}
      <div className="flex-1 w-full relative">
        {!activeFile ? (
          /* No file open — show actionable empty state */
          <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-zinc-950 select-none">
            <FileCode className="w-10 h-10 text-zinc-700 mb-3" />
            <p className="text-zinc-300 font-semibold mb-1 text-sm">No File Open</p>
            <p className="text-zinc-600 max-w-xs text-xs mb-5">
              Generate a site with the AI chat, or create a new file to start coding manually.
            </p>
            {handleNewFile && (
              <button
                onClick={handleNewFile}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 text-xs font-medium transition-colors"
              >
                <FilePlus className="w-4 h-4 text-blue-400" />
                Create New File
              </button>
            )}
          </div>
        ) : (
          /* Monaco editor — shown even for empty files so user can type */
          <MonacoErrorBoundary fallbackFile={activeFile}>
            <Editor
              path={activeFile}
              height="100%"
              language={getLanguageFromPath(activeFile)}
              value={currentContent}
              theme="vs-dark"
              onChange={(val: string | undefined) => {
                if (activeFile && val !== undefined) {
                  updateFile(activeFile, val);
                  // Mark as unsaved; auto-save happens immediately in store
                  setIsSaved(false);
                  if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
                  saveTimerRef.current = setTimeout(() => setIsSaved(true), 800);
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
        )}
      </div>

      {/* Ctrl+S Auto-save Toast */}
      {showSaveToast && (
        <div className="absolute bottom-4 right-4 flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-xs text-emerald-400 font-medium shadow-lg animate-fade-in pointer-events-none">
          <Check className="w-3.5 h-3.5" />
          Auto-saved
        </div>
      )}
    </div>
  );
}


