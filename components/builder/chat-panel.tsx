'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  Send,
  Sparkles,
  Bot,
  User,
  Loader2,
  Lightbulb,
} from 'lucide-react';
import { useProjectStore } from '@/lib/store/project-store';
import { parseFilesFromMarkdown } from '@/lib/ai/code-parser';
import { SUGGESTED_PROMPTS } from '@/lib/ai/prompt-templates';

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
  } = useProjectStore();

  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, status]);

  const handleSubmit = async (promptText: string) => {
    const query = promptText.trim();
    if (!query || status === 'generating') return;

    setInput('');
    onGenerateStart?.();

    // 1. Add User Message
    addMessage({ role: 'user', content: query });
    setStatus('generating', 'Generating fullstack code with Gemini...');
    addLog(`[AI] Generating prompt: "${query.slice(0, 60)}..."`);

    try {
      // 2. Call streaming endpoint
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: query,
          framework,
          history: messages.map((m) => ({ role: m.role, content: m.content })),
          currentFiles: files,
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error(`HTTP error ${response.status}`);
      }

      // 3. Read stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulatedText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        accumulatedText += chunk;

        // Parse files incrementally from the stream
        const parsed = parseFilesFromMarkdown(accumulatedText);
        if (Object.keys(parsed).length > 0) {
          setFiles({
            ...files,
            ...parsed,
          });
        }
      }

      // Final pass on full stream
      const finalFiles = parseFilesFromMarkdown(accumulatedText);
      if (Object.keys(finalFiles).length > 0) {
        setFiles({
          ...files,
          ...finalFiles,
        });
        addLog(`[AI] Successfully parsed ${Object.keys(finalFiles).length} project files.`);
      }

      // Add assistant response
      addMessage({
        role: 'assistant',
        content: accumulatedText.slice(0, 300) + (accumulatedText.length > 300 ? '...\n\n✅ Files updated in editor and ready for preview.' : ''),
      });

      setStatus('ready', 'Application ready');
    } catch (err: any) {
      console.error('Generation failed:', err);
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
            className={`flex gap-2.5 text-xs ${
              msg.role === 'user' ? 'justify-end' : 'justify-start'
            }`}
          >
            {msg.role === 'assistant' && (
              <div className="w-6 h-6 rounded-full bg-blue-600/20 border border-blue-500/30 flex items-center justify-center shrink-0 mt-0.5">
                <Bot className="w-3.5 h-3.5 text-blue-400" />
              </div>
            )}

            <div
              className={`max-w-[85%] rounded-xl px-3 py-2 leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-zinc-900 border border-zinc-800 text-zinc-300'
              }`}
            >
              <p className="whitespace-pre-wrap">{msg.content}</p>
            </div>

            {msg.role === 'user' && (
              <div className="w-6 h-6 rounded-full bg-zinc-800 flex items-center justify-center shrink-0 mt-0.5">
                <User className="w-3.5 h-3.5 text-zinc-400" />
              </div>
            )}
          </div>
        ))}

        {status === 'generating' && (
          <div className="flex items-center gap-2 text-xs text-blue-400 bg-blue-500/10 border border-blue-500/20 rounded-lg p-2.5">
            <Loader2 className="w-4 h-4 animate-spin shrink-0" />
            <span>Streaming multi-file code...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Suggested prompts if few messages */}
      {messages.length <= 2 && (
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
