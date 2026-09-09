'use client';

// Force dynamic rendering — builder uses browser-only APIs (cuid, Nodebox, esbuild-wasm)
export const dynamic = 'force-dynamic';

import React, { useEffect, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useProjectStore } from '@/lib/store/project-store';
import { BuilderHeader } from '@/components/builder/builder-header';
import { ChatPanel } from '@/components/builder/chat-panel';
import { FileTree } from '@/components/builder/file-tree';
import { CodeEditor } from '@/components/builder/code-editor';
import { PreviewPane } from '@/components/builder/preview-pane';

function BuilderWorkspace() {
  const { mode, status, setStatus, addMessage, files, setFiles, framework, addLog } = useProjectStore();
  const searchParams = useSearchParams();
  const hasTriggeredInitialPrompt = useRef(false);

  // Read prompt from search params and auto-start generation
  useEffect(() => {
    const initialPrompt = searchParams.get('prompt');
    if (initialPrompt && !hasTriggeredInitialPrompt.current && status === 'idle') {
      hasTriggeredInitialPrompt.current = true;
      
      const runInitialGeneration = async () => {
        addMessage({ role: 'user', content: initialPrompt });
        setStatus('generating', 'Generating website with Gemini 3.6 Flash...');
        addLog(`[AI] Auto-generating from prompt: "${initialPrompt}"`);

        try {
          const response = await fetch('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              prompt: initialPrompt,
              framework,
              history: [],
              currentFiles: {}, // empty → AI creates fresh project from scratch
            }),
          });

          if (!response.ok || !response.body) {
            throw new Error(`HTTP error ${response.status}`);
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let accumulatedText = '';
          const { parseFilesFromMarkdown } = await import('@/lib/ai/code-parser');

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            accumulatedText += chunk;

            const parsed = parseFilesFromMarkdown(accumulatedText);
            if (Object.keys(parsed).length > 0) {
              setFiles({
                ...files,
                ...parsed,
              });
            }
          }

          const finalFiles = parseFilesFromMarkdown(accumulatedText);
          if (Object.keys(finalFiles).length > 0) {
            setFiles({
              ...files,
              ...finalFiles,
            });
            addLog(`[AI] Generated ${Object.keys(finalFiles).length} project files.`);
          }

          const fileList = Object.keys(finalFiles);
          addMessage({
            role: 'assistant',
            content: `✅ Generated **${fileList.length} project files**:\n` +
              fileList.map((f) => `- \`${f}\``).join('\n') +
              '\n\nAll components are mounted in the editor and live in the preview pane!',
          });

          setStatus('ready', 'Project ready');
        } catch (err: any) {
          console.error('Initial generation failed:', err);
          setStatus('error', err?.message || 'Failed to generate');
          addLog(`[Error] ${err?.message || 'Initial generation failed'}`);
          addMessage({
            role: 'assistant',
            content: `⚠️ Initial generation encountered an issue: ${err?.message || 'Connection error'}. You can re-submit your prompt below to regenerate.`,
          });
        }
      };

      runInitialGeneration();
    }
  }, [searchParams]);

  return (
    <div className="h-screen w-screen flex flex-col bg-zinc-950 overflow-hidden text-zinc-100">
      {/* Top Header */}
      <BuilderHeader />

      {/* Main Workspace Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Chat Panel */}
        <ChatPanel />

        {/* Center / Right Dynamic Workspace */}
        <div className="flex-1 flex overflow-hidden">
          {mode === 'split' && (
            <>
              <FileTree />
              <CodeEditor />
              <PreviewPane />
            </>
          )}

          {mode === 'code' && (
            <>
              <FileTree />
              <CodeEditor />
            </>
          )}

          {mode === 'preview' && (
            <PreviewPane />
          )}
        </div>
      </div>
    </div>
  );
}

export default function BuilderPage() {
  return (
    <Suspense fallback={<div className="h-screen w-screen bg-zinc-950 flex items-center justify-center text-zinc-400">Loading Workspace...</div>}>
      <BuilderWorkspace />
    </Suspense>
  );
}
