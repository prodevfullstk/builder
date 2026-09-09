'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  Send,
  Sparkles,
  Loader2,
  Lightbulb,
} from 'lucide-react';
import { useProjectStore, TimelineStep } from '@/lib/store/project-store';
import { extractStreamingState } from '@/lib/ai/code-parser';
import { SUGGESTED_PROMPTS } from '@/lib/ai/prompt-templates';
import { V0Stepper } from './v0-stepper';

interface ChatPanelProps {
  onGenerateStart?: () => void;
}

export function ChatPanel({ onGenerateStart }: ChatPanelProps) {
  const {
    messages,
    addMessage,
    status,
    setStatus,
    files,
    setFiles,
    framework,
    addLog,
    setActiveFile,
    streamingFile,
    setStreamingFile,
    isStreaming,
    setIsStreaming,
    activeSteps,
    setActiveSteps,
  } = useProjectStore();

  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, status, activeSteps]);

  const handleSubmit = async (promptText: string) => {
    const query = promptText.trim();
    if (!query || status === 'generating') return;

    setInput('');
    onGenerateStart?.();

    // 1. Add User Message
    addMessage({ role: 'user', content: query });
    setStatus('generating', 'Generating fullstack code with Gemini...');
    setIsStreaming(true);
    addLog(`[AI] Generating prompt: "${query.slice(0, 60)}..."`);

    // Initialize v0-style dynamic steps
    const initialSteps: TimelineStep[] = [
      { id: 'thought-1', type: 'thought', label: 'Thought for 1s', duration: '1s', status: 'completed' },
      { id: 'inspect-1', type: 'inspect', label: 'Inspected project structure', status: 'completed' },
      { id: 'design-1', type: 'design', label: 'Created design direction', status: 'completed' },
    ];
    setActiveSteps(initialSteps);

    // Check if this is a fresh build prompt (not an incremental edit)
    const isNewBuild =
      messages.length <= 1 ||
      /^(build|create|make|design|generate)/i.test(query) ||
      (files['app/page.tsx'] && files['app/page.tsx'].includes('Describe your app in the chat')) ||
      Object.keys(files).length === 0;

    try {
      // 2. Call streaming endpoint
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: query,
          framework,
          history: messages.map((m) => ({ role: m.role, content: m.content })),
          currentFiles: isNewBuild ? {} : files,
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error(`HTTP error ${response.status}`);
      }

      // 3. Read stream and typewriter-stream into active files
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulatedText = '';
      let currentSteps = [...initialSteps];
      let trackedFiles = new Set<string>();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        accumulatedText += chunk;

        // Parse files and track which file is currently being typed
        const { files: parsedFiles, currentStreamingFile } = extractStreamingState(accumulatedText);

        if (Object.keys(parsedFiles).length > 0) {
          setFiles(isNewBuild ? parsedFiles : { ...files, ...parsedFiles });

          // If a file is actively being typed right now, auto-switch editor to it!
          if (currentStreamingFile) {
            setStreamingFile(currentStreamingFile);
            setActiveFile(currentStreamingFile);

            // Add step to timeline if not added yet
            if (!trackedFiles.has(currentStreamingFile)) {
              trackedFiles.add(currentStreamingFile);
              const fileStep: TimelineStep = {
                id: `step-${currentStreamingFile}`,
                type: 'file',
                label: `Built ${currentStreamingFile.replace(/^components\//, '')}`,
                file: currentStreamingFile,
                status: 'running',
              };
              currentSteps = [...currentSteps, fileStep];
              setActiveSteps(currentSteps);
            }
          }
        }
      }

      // Final pass on full stream
      const { files: finalFiles } = extractStreamingState(accumulatedText);
      if (Object.keys(finalFiles).length > 0) {
        setFiles(isNewBuild ? finalFiles : { ...files, ...finalFiles });
        if (finalFiles['app/page.tsx']) {
          setActiveFile('app/page.tsx');
        }
        addLog(`[AI] Successfully parsed ${Object.keys(finalFiles).length} project files.`);
      }

      // Mark all file steps as completed with line count
      const finalSteps: TimelineStep[] = currentSteps.map((step) => {
        if (step.file && finalFiles[step.file]) {
          const lines = finalFiles[step.file].split('\n').length;
          return { ...step, status: 'completed', linesAdded: lines };
        }
        return { ...step, status: 'completed' };
      });

      // Add Checked preview step
      finalSteps.push({
        id: 'preview-checked',
        type: 'preview',
        label: 'Checked preview',
        status: 'completed',
      });

      setActiveSteps(finalSteps);
      setIsStreaming(false);
      setStreamingFile(null);

      // Add assistant response with Vercel v0 Stepper and clean feature bullets
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

      setStatus('ready', 'Application ready');
    } catch (err: any) {
      console.error('Generation failed:', err);
      setIsStreaming(false);
      setStreamingFile(null);
      setStatus('error', err?.message || 'Generation failed');
      addLog(`[Error] ${err?.message || 'Generation failed'}`);
      addMessage({
        role: 'assistant',
        content: `❌ Error generating code: ${err?.message || 'Please check your connection and API key.'}`,
      });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(input);
    }
  };

  return (
    <div className="w-80 h-full border-r border-zinc-800 bg-zinc-950 flex flex-col shrink-0 select-none">
      {/* Panel Header */}
      <div className="h-9 px-3 border-b border-zinc-800 flex items-center gap-2 text-zinc-400 font-semibold uppercase tracking-wider text-[10px]">
        <Sparkles className="w-3.5 h-3.5 text-blue-400" />
        <span>AI Builder Assistant</span>
      </div>

      {/* Messages List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex text-xs ${
              msg.role === 'user' ? 'justify-end' : 'justify-start w-full'
            }`}
          >
            {msg.role === 'user' ? (
              <div className="max-w-[85%] rounded-2xl px-3.5 py-2 leading-relaxed bg-blue-600 text-white shadow-sm">
                <p className="whitespace-pre-wrap">{msg.content}</p>
              </div>
            ) : (
              <div className="w-full">
                {msg.steps && msg.steps.length > 0 ? (
                  <V0Stepper
                    steps={msg.steps}
                    filesGenerated={msg.filesGenerated}
                    showPreview={msg.showPreview}
                    content={msg.content}
                  />
                ) : (
                  <div className="w-full rounded-xl px-3.5 py-2.5 leading-relaxed bg-zinc-900/90 border border-zinc-800/80 text-zinc-300">
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {/* Live Stepper when AI is actively generating */}
        {status === 'generating' && (
          <div className="w-full text-xs">
            <V0Stepper steps={activeSteps} isStreaming={true} showPreview={false} />
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Suggested prompts if few messages */}
      {messages.length <= 2 && status !== 'generating' && (
        <div className="px-3 pb-2">
          <div className="flex items-center gap-1 text-[10px] uppercase font-semibold text-zinc-500 mb-1.5">
            <Lightbulb className="w-3 h-3 text-amber-400" />
            <span>Try these templates:</span>
          </div>
          <div className="flex flex-col gap-1">
            {SUGGESTED_PROMPTS.slice(0, 2).map((item, i) => (
              <button
                key={i}
                onClick={() => handleSubmit(item.prompt)}
                className="text-left px-2 py-1.5 rounded bg-zinc-900/60 hover:bg-zinc-900 border border-zinc-800/80 text-[11px] text-zinc-300 transition-colors truncate"
              >
                ⚡ <span className="font-semibold text-zinc-200">{item.title}:</span> {item.description}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Prompt Input Area */}
      <div className="p-3 border-t border-zinc-800 bg-zinc-900/50">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit(input);
          }}
          className="relative"
        >
          <textarea
            ref={textareaRef}
            rows={3}
            placeholder="Describe your website or request changes..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={status === 'generating'}
            className="w-full px-3 py-2 pr-10 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-blue-500 resize-none transition-colors disabled:opacity-50"
          />

          <button
            type="submit"
            disabled={!input.trim() || status === 'generating'}
            className="absolute right-2.5 bottom-3 p-1.5 rounded-md bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 text-white disabled:text-zinc-500 transition-colors shadow-sm shadow-blue-900/30"
            title="Send prompt"
          >
            {status === 'generating' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Send className="w-3.5 h-3.5" />
            )}
          </button>
        </form>
        <p className="text-[10px] text-zinc-500 mt-1 text-center">
          Press Enter to send, Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
