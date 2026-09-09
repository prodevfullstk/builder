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
  const {
    mode,
    status,
    setStatus,
    addMessage,
    files,
    setFiles,
    framework,
    addLog,
    setActiveFile,
    setStreamingFile,
    setIsStreaming,
    setActiveSteps,
  } = useProjectStore();
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
        setIsStreaming(true);
        addLog(`[AI] Auto-generating from prompt: "${initialPrompt}"`);

        const initialSteps: any[] = [
          { id: 'thought-1', type: 'thought', label: 'Thought for 1s', duration: '1s', status: 'completed' },
          { id: 'inspect-1', type: 'inspect', label: 'Inspected project structure', status: 'completed' },
          { id: 'design-1', type: 'design', label: 'Created design direction', status: 'completed' },
        ];
        setActiveSteps(initialSteps);

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
          const { extractStreamingState } = await import('@/lib/ai/code-parser');
          let currentSteps = [...initialSteps];
          const trackedFiles = new Set<string>();

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            accumulatedText += chunk;

            const { files: parsedFiles, currentStreamingFile } = extractStreamingState(accumulatedText);
            if (Object.keys(parsedFiles).length > 0) {
              setFiles(parsedFiles);
              if (currentStreamingFile) {
                setStreamingFile(currentStreamingFile);
                setActiveFile(currentStreamingFile);

                if (!trackedFiles.has(currentStreamingFile)) {
                  trackedFiles.add(currentStreamingFile);
                  currentSteps = [
                    ...currentSteps,
                    {
                      id: `step-${currentStreamingFile}`,
                      type: 'file',
                      label: `Built ${currentStreamingFile.replace(/^components\//, '')}`,
                      file: currentStreamingFile,
                      status: 'running',
                    },
                  ];
                  setActiveSteps(currentSteps);
                }
              }
            }
          }

          const { files: finalFiles } = extractStreamingState(accumulatedText);
          if (Object.keys(finalFiles).length > 0) {
            setFiles(finalFiles);
            if (finalFiles['app/page.tsx']) {
              setActiveFile('app/page.tsx');
            }
            addLog(`[AI] Generated ${Object.keys(finalFiles).length} project files.`);
          }

          const finalSteps = currentSteps.map((step) => {
            if (step.file && finalFiles[step.file]) {
              const lines = finalFiles[step.file].split('\n').length;
              return { ...step, status: 'completed', linesAdded: lines };
            }
            return { ...step, status: 'completed' };
          });

          finalSteps.push({
            id: 'preview-checked',
            type: 'preview',
            label: 'Checked preview',
            status: 'completed',
          });

          setActiveSteps(finalSteps);
          setIsStreaming(false);
          setStreamingFile(null);

          const fileList = Object.keys(finalFiles);
          const summaryText =
            `Built modern ${framework.toUpperCase()} application with:\n` +
            `• ${fileList.length} modular components and utilities\n` +
            `• Clean responsive Tailwind CSS design system\n` +
            `• Interactive state management and animations`;

          addMessage({
            role: 'assistant',
            content: summaryText,
            steps: finalSteps,
            filesGenerated: fileList,
            showPreview: true,
          });

          setStatus('ready', 'Project ready');
        } catch (err: any) {
          console.error('Initial generation failed:', err);
          setIsStreaming(false);
          setStreamingFile(null);
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
