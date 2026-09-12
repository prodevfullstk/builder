'use client';

import React, { useState, useMemo } from 'react';
import dynamic from 'next/dynamic';
import {
  RotateCcw,
  ExternalLink,
  Monitor,
  Tablet,
  Smartphone,
  Terminal,
  ChevronUp,
  ChevronDown,
  Zap,
  Box,
  Server,
  Sparkles,
  AlertTriangle,
  Loader2,
  Cloud,
} from 'lucide-react';
import { useProjectStore } from '@/lib/store/project-store';
import { InstantPreview } from '@/components/preview/instant-preview';
import { detectBackendEntry } from '@/lib/sandbox/detect-backend';
import { parseToolCalls, executeToolCalls } from '@/lib/ai/mcp-executor';
import { parseFinalOutput } from '@/lib/ai/code-parser';
import { evaluateCandidateChanges } from '@/lib/validation/candidate-pipeline';
import { bundleProjectWithEsbuild } from '@/lib/preview/esbuild-compiler';

// Dynamically import sandbox engines with ssr: false
const VercelPreview = dynamic(
  () => import('@/components/sandbox/vercel-preview').then((m) => m.VercelPreview),
  { ssr: false }
);

const NodeboxPreview = dynamic(
  () => import('@/components/sandbox/nodebox-preview').then((m) => m.NodeboxPreview),
  { ssr: false }
);

export function PreviewPane() {
  const {
    projectId,
    files,
    setFiles,
    framework,
    status,
    setStatus,
    logs,
    clearLogs,
    addLog,
    updateLastMessageScreenshot,
    runtimeError,
    setRuntimeError,
    clearRuntimeError,
    autoFixAttempts,
    incrementAutoFixAttempts,
    resetAutoFixAttempts,
  } = useProjectStore();
  const [viewport, setViewport] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [showLogs, setShowLogs] = useState(false);
  const [previewKey, setPreviewKey] = useState(1);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [backendUrl, setBackendUrl] = useState<string | null>(null);
  const [engine, setEngine] = useState<'vercel' | 'instant' | 'nodebox'>('vercel');
  const [compilationMode, setCompilationMode] = useState<'simulated-dom' | 'virtual-compiled'>('simulated-dom');

  const [isFixing, setIsFixing] = useState(false);

  // Detect if project has a backend server.js file
  const hasBackend = useMemo(() => {
    return detectBackendEntry(files) !== null;
  }, [files]);

  // Handle autonomous AI repair for preview errors
  const handleAutoFix = async () => {
    if (!runtimeError || isFixing) return;
    if (autoFixAttempts >= 2) {
      addLog('[Auto-Fix] Max consecutive auto-fix attempts (2) reached. Please check the code manually.');
      return;
    }

    setIsFixing(true);
    incrementAutoFixAttempts();
    addLog(`[Auto-Fix] Attempt ${autoFixAttempts + 1}/2: Diagnosing preview error...`);

    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'auto-fix',
          message: runtimeError,
          files,
          framework,
        }),
      });

      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
      }

      // Extract candidate changes
      let candidateFiles: Record<string, string> = { ...files };
      const { toolCalls } = parseToolCalls(accumulated);
      if (toolCalls.length > 0) {
        const result = executeToolCalls(files, toolCalls);
        candidateFiles = result.updatedFiles;
        result.logs.forEach((l) => addLog(l));
        addLog(`[Auto-Fix] Parsed ${toolCalls.length} repair tool calls.`);
      } else {
        const { files: fixedFiles } = parseFinalOutput(accumulated);
        if (Object.keys(fixedFiles).length > 0) {
          candidateFiles = { ...files, ...fixedFiles };
          addLog(`[Auto-Fix] Parsed ${Object.keys(fixedFiles).length} repaired files.`);
        } else {
          addLog('[Auto-Fix] No repair candidates produced by AI.');
          return;
        }
      }

      // 1. Candidate Validation Gate (Security, framework contract, secrets)
      addLog(`[Auto-Fix] Validating candidate repair changes against ${framework.toUpperCase()} contract...`);
      const evalResult = await evaluateCandidateChanges({
        projectId: projectId || 'workspace',
        framework,
        currentFiles: files,
        candidateFiles,
        isNewBuild: false,
      });

      if (!evalResult.accepted) {
        addLog(`[Auto-Fix Rejected] Candidate failed validation: ${evalResult.diagnostics.join(' | ')}`);
        setRuntimeError(`Auto-Fix rejected: ${evalResult.diagnostics[0] || 'Unsafe changes'}`);
        return;
      }

      // 2. Virtual Compilation Verification Gate
      addLog('[Auto-Fix] Verifying compilation of repaired files...');
      const checkResult = await bundleProjectWithEsbuild(evalResult.committedFiles);
      if (checkResult.errors.length > 0) {
        addLog(`[Auto-Fix Rejected] Repair code caused compilation errors: ${checkResult.errors[0].slice(0, 100)}`);
        setRuntimeError(`Compilation Error: ${checkResult.errors[0]}`);
        return;
      }

      // 3. Transactional Commit
      setFiles(evalResult.committedFiles);
      clearRuntimeError();
      setPreviewKey((k) => k + 1);
      addLog(`[Auto-Fix] ✓ Successfully repaired and verified (${evalResult.evidence.checks.length} checks passed, 0 errors).`);
    } catch (err: any) {
      addLog(`[Auto-Fix Failed] ${err?.message || 'Repair attempt failed'}`);
    } finally {
      setIsFixing(false);
    }
  };



  const getViewportWidth = () => {
    switch (viewport) {
      case 'mobile':
        return '375px';
      case 'tablet':
        return '768px';
      default:
        return '100%';
    }
  };

  const handleRefresh = () => {
    setPreviewKey((prev) => prev + 1);
    addLog(`[Preview] Reloading preview (${engine} engine)...`);
  };

  const handleOpenExternal = () => {
    if (previewUrl) {
      window.open(previewUrl, '_blank');
    }
  };

  return (
    <div className="flex-1 h-full flex flex-col bg-zinc-950 overflow-hidden select-none border-l border-zinc-800">
      {/* Preview Header & Controls */}
      <div className="h-9 px-3 border-b border-zinc-800 bg-zinc-900/80 flex items-center justify-between">
        {/* Left: Viewport Toggles & Engine Switcher */}
        <div className="flex items-center gap-2">
          {/* Viewport controls */}
          <div className="flex items-center gap-1 bg-zinc-950 p-0.5 rounded-md border border-zinc-800">
            <button
              onClick={() => setViewport('desktop')}
              className={`p-1 rounded text-xs transition-colors ${
                viewport === 'desktop'
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
              title="Desktop View (100%)"
            >
              <Monitor className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setViewport('tablet')}
              className={`p-1 rounded text-xs transition-colors ${
                viewport === 'tablet'
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
              title="Tablet View (768px)"
            >
              <Tablet className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setViewport('mobile')}
              className={`p-1 rounded text-xs transition-colors ${
                viewport === 'mobile'
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
              title="Mobile View (375px)"
            >
              <Smartphone className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Center: URL Bar Mockup & Truthful Verification Badge */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-zinc-950 border border-zinc-800/80 text-[11px] text-zinc-400 font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block animate-pulse" />
            <span className="truncate max-w-[180px]">
              {engine === 'vercel'
                ? previewUrl ? previewUrl.replace(/^https?:\/\//, '') : 'sandbox.vercel.run'
                : engine === 'instant'
                ? 'preview.local'
                : 'localhost:3000'}
            </span>
            {hasBackend && engine === 'instant' && (
              <span
                className="ml-1 flex items-center gap-0.5 text-emerald-400/80"
                title="Backend API auto-detected and bridged via Nodebox"
              >
                <Server className="w-2.5 h-2.5" />
                <span className="text-[10px]">+API</span>
              </span>
            )}
          </div>

          {/* Truthful Preview Mode Badge */}
          <span
            className={`px-2 py-0.5 rounded text-[10px] font-mono border ${
              engine === 'vercel'
                ? previewUrl
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                  : 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                : engine === 'instant'
                ? compilationMode === 'virtual-compiled'
                  ? 'bg-blue-500/10 border-blue-500/30 text-blue-400'
                  : 'bg-zinc-800 border-zinc-700 text-zinc-400'
                : 'bg-violet-500/10 border-violet-500/30 text-violet-400'
            }`}
            title="Active preview engine and verification tier"
          >
            {engine === 'vercel'
              ? previewUrl
                ? 'Native Verified (Vercel)'
                : 'Native Sandbox (Initializing)'
              : engine === 'instant'
              ? compilationMode === 'virtual-compiled'
                ? 'Virtual Compilation (esbuild)'
                : 'Visual Preview (Simulated DOM)'
              : 'Nodebox Container'}
          </span>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-1">
          {(engine === 'vercel' || engine === 'nodebox') && (
            <button
              onClick={() => setShowLogs(!showLogs)}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] transition-colors ${
                showLogs
                  ? 'bg-zinc-800 text-blue-400 font-medium'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
              }`}
              title="Toggle Runtime Logs"
            >
              <Terminal className="w-3 h-3" />
              <span>Logs</span>
              {showLogs ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
            </button>
          )}

          <button
            onClick={handleRefresh}
            className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
            title="Reload Preview"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          {previewUrl && (engine === 'vercel' || engine === 'nodebox') && (
            <button
              onClick={handleOpenExternal}
              className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
              title="Open in new window"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Auto-Fix Error Banner */}
      {runtimeError && (
        <div className="shrink-0 flex items-center justify-between gap-3 px-3 py-2 bg-red-500/15 border-b border-red-500/30 text-xs">
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
            <div className="min-w-0">
              <span className="font-semibold text-red-300">Preview Error: </span>
              <span className="text-red-200/90 font-mono truncate inline-block max-w-md align-bottom">
                {runtimeError}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {autoFixAttempts < 2 ? (
              <button
                onClick={handleAutoFix}
                disabled={isFixing}
                className="flex items-center gap-1.5 px-2.5 py-1 bg-red-600 hover:bg-red-500 text-white rounded font-medium text-xs transition-colors disabled:opacity-50 shadow-sm cursor-pointer"
              >
                {isFixing ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Repairing...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Auto-Fix with AI</span>
                  </>
                )}
              </button>
            ) : (
              <span className="text-zinc-400 text-[11px]">Max auto-fixes reached</span>
            )}
            <button
              onClick={clearRuntimeError}
              className="text-red-400 hover:text-red-200 p-1 cursor-pointer"
              title="Dismiss error"
            >
              ✕
            </button>
          </div>
        </div>
      )}



      {/* Main Preview Container */}
      <div className="flex-1 bg-zinc-900/40 p-3 flex justify-center items-center overflow-auto relative">
        <div
          style={{ width: getViewportWidth() }}
          className="h-full bg-zinc-950 border border-zinc-800 rounded-lg shadow-2xl overflow-hidden transition-all duration-300 flex flex-col"
        >
          {engine === 'vercel' ? (
            <VercelPreview
              key={`vercel-${previewKey}`}
              files={files}
              projectId={projectId || 'default'}
              framework={framework}
              refreshNonce={previewKey}
              onStatusChange={(newStatus: string) => {
                if (newStatus === 'ready') {
                  setStatus('ready', 'Vercel Sandbox ready');
                } else if (newStatus === 'error') {
                  setStatus('error', 'Runtime error occurred');
                } else {
                  setStatus('starting', `${newStatus}...`);
                }
              }}
              onError={(err: string) => {
                addLog(`[Vercel Sandbox Error] ${err} — falling back to Instant Preview.`);
                setRuntimeError(err);
                setEngine('instant');
              }}
              onReady={(url: string) => {
                setPreviewUrl(url);
                addLog(`[Vercel Sandbox Ready] Live at ${url}`);
              }}
              onLog={(msg: string) => addLog(msg)}
            />
          ) : engine === 'instant' ? (
            <InstantPreview
              key={`instant-${previewKey}`}
              files={files}
              refreshNonce={previewKey}
              backendUrl={backendUrl}
              onError={(err) => {
                addLog(`[Preview Error] ${err}`);
                setRuntimeError(err);
                if (hasBackend) {
                  addLog('[Preview Fallback] Backend detected — switching to Nodebox runtime.');
                  setEngine('nodebox');
                }
              }}
              onScreenshot={(dataUrl) => {
                updateLastMessageScreenshot(dataUrl);
              }}
              onEngineStatusChange={setCompilationMode}
            />
          ) : (
            <NodeboxPreview
              key={`nodebox-${previewKey}`}
              files={files}
              framework={framework}
              onStatusChange={(newStatus: string) => {
                if (newStatus === 'ready') {
                  setStatus('ready', 'Preview ready');
                } else if (newStatus === 'error') {
                  setStatus('error', 'Runtime error occurred');
                } else {
                  setStatus('starting', `${newStatus}...`);
                }
              }}
              onError={(err: string) => {
                addLog(`[Nodebox Error] ${err}`);
              }}
              onReady={(url: string) => {
                setPreviewUrl(url);
                // Expose backend URL for API proxy bridge when switching back to instant mode
                if (hasBackend) {
                  setBackendUrl(url);
                  addLog(`[Backend API] Bridge URL captured: ${url}`);
                }
                addLog(`[Nodebox Ready] Serving at ${url}`);
              }}
            />
          )}
        </div>
      </div>

      {/* Terminal Logs Drawer */}
      {showLogs && (
        <div className="h-44 border-t border-zinc-800 bg-zinc-950 flex flex-col text-xs font-mono select-text">
          <div className="h-7 px-3 border-b border-zinc-900 bg-zinc-900/60 flex items-center justify-between text-zinc-400 text-[10px]">
            <div className="flex items-center gap-1.5">
              <Terminal className="w-3 h-3 text-blue-400" />
              <span>Nodebox Runtime Console</span>
            </div>
            <button
              onClick={clearLogs}
              className="text-zinc-500 hover:text-zinc-300 hover:underline text-[10px]"
            >
              Clear Logs
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1 text-zinc-400 text-[11px]">
            {logs.map((log, i) => (
              <div
                key={i}
                className={`leading-relaxed ${
                  log.includes('[Error]') || log.includes('error')
                    ? 'text-red-400'
                    : log.includes('[Nodebox Ready]')
                    ? 'text-emerald-400 font-semibold'
                    : log.includes('[AI]')
                    ? 'text-sky-400'
                    : 'text-zinc-400'
                }`}
              >
                {log}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
