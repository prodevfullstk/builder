'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  Send,
  Loader2,
} from 'lucide-react';

// VS Code-style sidebar panel toggle icon
function PanelToggleIcon({ mirrored = false }: { mirrored?: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ transform: mirrored ? 'scaleX(-1)' : undefined }}
    >
      {/* Outer rectangle */}
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      {/* Left panel stripe */}
      <rect x="1.5" y="2.5" width="4" height="11" rx="1.5" fill="currentColor" opacity="0.9" />
      {/* Inner right divider line */}
      <line x1="5.5" y1="2.5" x2="5.5" y2="13.5" stroke="currentColor" strokeWidth="1.2" opacity="0.5" />
    </svg>
  );
}
import { useProjectStore, TimelineStep } from '@/lib/store/project-store';
import { extractStreamingState, parseFinalOutput } from '@/lib/ai/code-parser';
import { parseToolCalls, executeToolCalls } from '@/lib/ai/mcp-executor';
import { SUGGESTED_PROMPTS } from '@/lib/ai/prompt-templates';
import { V0Stepper } from './v0-stepper';

interface ChatPanelProps {
  onGenerateStart?: () => void;
}

export function ChatPanel({ onGenerateStart }: ChatPanelProps) {
  const {
    messages,
    addMessage,
    updateStreamingMessage,
    status,
    setStatus,
    files,
    setFiles,
    framework,
    dbProvider,
    authProvider,
    addLog,
    setActiveFile,
    streamingFile,
    setStreamingFile,
    isStreaming,
    setIsStreaming,
    activeSteps,
    setActiveSteps,
    runtimeError,
    clearRuntimeError,
  } = useProjectStore();

  const [input, setInput] = useState('');
  const [isMinimized, setIsMinimized] = useState(false);
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
    addMessage({ role: 'user', content: query });

    // Detect intent — AI agent handles both chat and build
    // 1. English + Bengali build verbs
    const hasBuildVerb = /\b(build|create|make|design|generate|develop|add|fix|update|modify|refactor|implement)\b/i.test(query)
      || /(বানাও|তৈরি|বানিয়ে|শুরু|কোড|করো|দাও|ডিজাইন|পরিবর্তন|যুক্ত|যোগ|সাজাও)/i.test(query);

    // 2. English + Bengali app/web nouns
    const hasAppNoun = /\b(app|website|site|page|landing|dashboard|saas|portfolio|store|blog|form|api|backend|component|navbar|hero|footer|modal)\b/i.test(query)
      || /(সাইট|ওয়েবসাইট|অ্যাপ|পেজ|ল্যান্ডিং|ড্যাশবোর্ড|দোকান|স্টোর|ব্লগ|ফর্ম|কম্পোনেন্ট|প্রজেক্ট)/i.test(query);

    // 3. Conversational continuation: user confirming after discussion (e.g. "go ahead", "start now", "yes", "do it", "হ্যাঁ", "শুরু করো")
    const isAffirmativeConfirmation = /^(yes|yeah|yep|sure|ok|okay|go ahead|start|start now|proceed|let's do it|do it|build it|now build|please build|হ্যাঁ|শুরু করো|বানাও|তৈরি করো|ঠিক আছে|করো|এগিয়ে যাও)/i.test(query.trim());

    const hasProjectContextInHistory = messages.length > 1 && messages.some((m) =>
      m.role === 'assistant' && (
        m.content.toLowerCase().includes('build') ||
        m.content.toLowerCase().includes('website') ||
        m.content.toLowerCase().includes('app') ||
        m.content.includes('তৈরি') ||
        m.content.includes('বানাতে') ||
        m.content.includes('প্রজেক্ট')
      )
    );

    const isConversationalBuildTrigger = isAffirmativeConfirmation && hasProjectContextInHistory;
    const isBuild = hasBuildVerb || (hasAppNoun && query.length > 15) || isConversationalBuildTrigger;

    // BUG4 fix: only wipe existing files when truly starting from scratch
    // "create a navbar" / "add a hero section" should NOT wipe the project
    const hasExistingFiles = Object.keys(files).length > 0;
    const isExplicitRebuild = /^(rebuild|start over|start fresh|from scratch|reset|clear project|new project)/i.test(query.trim());
    const isNewBuild = !hasExistingFiles || isExplicitRebuild;

    // ── CONVERSATION MODE ─────────────────────────────────────
    if (!isBuild) {
      setStatus('generating', 'Thinking...');
      // ISSUE9 fix: stream chat replies token-by-token
      let streamContent = '';
      try {
        const response = await fetch('/api/agent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: query,
            history: messages
              .filter((m) => m.content && m.content.trim() !== '' && m.content !== '…')
              .map((m) => ({ role: m.role, content: m.content })),
            framework,
            dbProvider,
            authProvider,
            mode: 'chat',
          }),
        });
        if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        // Add live streaming message — update it chunk by chunk
        addMessage({ role: 'assistant', content: '…' });

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          streamContent += decoder.decode(value, { stream: true });
          // Update the last assistant message with current streamed content
          updateStreamingMessage(streamContent);
        }
        // Final flush
        const flushed = decoder.decode();
        if (flushed) streamContent += flushed;
        updateStreamingMessage(streamContent.trim());

        // ── FAILSAFE: Check if the AI returned code in chat mode ──
        const { toolCalls, explanation: chatToolExpl } = parseToolCalls(streamContent);
        const { files: chatParsedFiles, aiExplanation: chatAiExpl } = parseFinalOutput(streamContent);

        let recoveredFiles: Record<string, string> = {};
        if (toolCalls.length > 0) {
          const mcpRes = executeToolCalls(files, toolCalls);
          recoveredFiles = mcpRes.updatedFiles;
          mcpRes.logs.forEach((l) => addLog(l));
        }
        if (Object.keys(chatParsedFiles).length > 0) {
          recoveredFiles = { ...recoveredFiles, ...chatParsedFiles };
        }

        if (Object.keys(recoveredFiles).length > 0) {
          addLog(`[Failsafe] Detected ${Object.keys(recoveredFiles).length} files in chat response — moving to editor & preview.`);
          const merged = { ...files, ...recoveredFiles };
          setFiles(merged);

          const entry = merged['app/page.tsx']
            ? 'app/page.tsx'
            : merged['src/App.tsx']
            ? 'src/App.tsx'
            : Object.keys(merged)[0];
          if (entry) setActiveFile(entry);

          // Clean chat message so raw code doesn't clutter the chat bubble
          const cleanChatMsg = chatToolExpl || chatAiExpl || 'I have generated and updated the project files in your workspace!';
          updateStreamingMessage(cleanChatMsg.trim());
          setStatus('ready', 'Application ready');
        } else {
          setStatus('idle');
        }
      } catch (err: any) {
        if (streamContent) {
          updateStreamingMessage(streamContent.trim() || 'Sorry, I had trouble connecting. Try again!');
        } else {
          addMessage({ role: 'assistant', content: 'Sorry, I had trouble connecting. Try again!' });
        }
        setStatus('idle');
      }
      return;
    }

    // Detect if this is an auto-fix request targeting an active preview error
    const isFixRequest = Boolean(runtimeError && /\b(fix|repair|error|broken|bug|issue|solve)\b/i.test(query));
    const effectiveMode = isFixRequest ? 'auto-fix' : 'build';
    const effectiveMessage = isFixRequest
      ? `${query}\n\nACTIVE PREVIEW ERROR TO FIX:\n${runtimeError}`
      : query;

    // ── BUILD / AUTO-FIX MODE ─────────────────────────────────
    setStatus('generating', isFixRequest ? 'AI is repairing the error...' : 'AI is building your project...');
    setIsStreaming(true);
    addLog(`[AI] ${isFixRequest ? 'Auto-fixing' : 'Building'}: "${query.slice(0, 60)}..."`);

    // Real dynamic timeline — starts with "Analyzing" only
    const analyzeStep: TimelineStep = {
      id: 'analyze-1',
      type: 'thought',
      label: isFixRequest
        ? `Diagnosing preview error for ${framework.toUpperCase()}...`
        : `Analyzing request for ${framework.toUpperCase()}...`,
      status: 'running',
    };
    setActiveSteps([analyzeStep]);

    try {
      const response = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: effectiveMessage,
          history: messages
            .filter((m) => m.content && m.content.trim() !== '' && m.content !== '…')
            .map((m) => ({ role: m.role, content: m.content })),
          files: isNewBuild && !isFixRequest ? {} : files,
          framework,
          dbProvider,
          authProvider,
          mode: effectiveMode,
        }),
      });

      if (!response.ok || !response.body) throw new Error(`HTTP error ${response.status}`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulatedText = '';
      let currentSteps: TimelineStep[] = [
        { ...analyzeStep, status: 'completed', label: isFixRequest ? `Diagnosed preview error` : `Analyzed request for ${framework.toUpperCase()}` },
      ];
      let trackedFiles = new Set<string>();
      let planningStepAdded = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        accumulatedText += chunk;

        // Add "Planning architecture" step once first tokens arrive
        if (!planningStepAdded && accumulatedText.length > 50) {
          planningStepAdded = true;
          const planStep: TimelineStep = {
            id: 'plan-1',
            type: 'inspect',
            label: `Planning ${framework} architecture...`,
            status: 'completed',
          };
          currentSteps = [...currentSteps, planStep];
          setActiveSteps(currentSteps);
        }

        // Streaming file detection — update steps as files are written
        const { files: parsedFiles, currentStreamingFile } = extractStreamingState(accumulatedText);

        if (Object.keys(parsedFiles).length > 0) {
          setFiles(isNewBuild ? parsedFiles : { ...files, ...parsedFiles });

          if (currentStreamingFile) {
            setStreamingFile(currentStreamingFile);
            setActiveFile(currentStreamingFile);

            if (!trackedFiles.has(currentStreamingFile)) {
              trackedFiles.add(currentStreamingFile);
              const fileStep: TimelineStep = {
                id: `step-${currentStreamingFile}`,
                type: 'file',
                label: `Creating ${currentStreamingFile.split('/').pop()}`,
                file: currentStreamingFile,
                status: 'running',
              };
              currentSteps = [...currentSteps, fileStep];
              setActiveSteps(currentSteps);
            }
          }
        }
      }

      // ── MCP Tool Execution Layer ──
      const { toolCalls, explanation: mcpExplanation } = parseToolCalls(accumulatedText);
      let mcpFiles = { ...(isNewBuild ? {} : files) };
      const hasToolCalls = toolCalls.length > 0;
      let toolSteps: TimelineStep[] = [];

      if (hasToolCalls) {
        const mcpResult = executeToolCalls(mcpFiles, toolCalls);
        mcpFiles = mcpResult.updatedFiles;
        mcpResult.logs.forEach((l) => addLog(l));

        toolSteps = mcpResult.executedTools.map((t, idx) => ({
          id: `mcp-${idx}-${t.path}`,
          type: 'file' as const,
          label: `[${t.tool}] ${t.path.split('/').pop()} (${t.action})`,
          file: t.path,
          status: 'completed' as const,
        }));
      }

      // ── Standard Parser (FILES block or markdown fences) ──
      const { files: parsedFiles, aiExplanation, parseError } = parseFinalOutput(accumulatedText);

      // Merge: MCP tool modifications take precedence, supplemented by parsed files
      const mergedFiles = hasToolCalls
        ? { ...parsedFiles, ...mcpFiles }
        : Object.keys(parsedFiles).length > 0
        ? (isNewBuild ? parsedFiles : { ...files, ...parsedFiles })
        : files;

      if (Object.keys(mergedFiles).length > 0) {
        setFiles(mergedFiles);
        // Auto-select entry file based on framework
        const entryFile = mergedFiles['app/page.tsx'] ? 'app/page.tsx'
          : mergedFiles['src/App.tsx'] ? 'src/App.tsx'
          : mergedFiles['src/pages/index.astro'] ? 'src/pages/index.astro'
          : Object.keys(mergedFiles)[0];
        if (entryFile) setActiveFile(entryFile);
        addLog(`[AI] Workspace updated: ${Object.keys(mergedFiles).length} files (${hasToolCalls ? `${toolCalls.length} MCP tools executed` : 'file parser'}).`);
      }

      // Mark all file steps as completed with line counts
      const finalSteps: TimelineStep[] = [
        ...currentSteps.map((step) => {
          if (step.file && mergedFiles[step.file]) {
            const lines = mergedFiles[step.file].split('\n').length;
            return { ...step, status: 'completed' as const, label: `Built ${step.file.split('/').pop()}`, linesAdded: lines };
          }
          return { ...step, status: 'completed' as const };
        }),
        ...toolSteps,
      ];
      finalSteps.push({ id: 'preview-checked', type: 'preview', label: 'Preview ready', status: 'completed' });

      setActiveSteps(finalSteps);
      setIsStreaming(false);
      setStreamingFile(null);

      // Use AI explanation if available, else generate a brief summary
      const fileList = Object.keys(mergedFiles);
      const chosenExplanation = mcpExplanation || aiExplanation;
      const responseContent = chosenExplanation && chosenExplanation.length > 20
        ? chosenExplanation
        : `Updated ${framework.toUpperCase()} project with ${fileList.length} files: ${fileList.slice(0, 4).map(f => f.split('/').pop()).join(', ')}${fileList.length > 4 ? '...' : ''}.`;

      addMessage({
        role: 'assistant',
        content: responseContent,
        steps: finalSteps,
        filesGenerated: fileList,
        showPreview: true,
      });

      if (isFixRequest) {
        clearRuntimeError();
      }

      setStatus('ready', 'Application ready');
    } catch (err: any) {
      console.error('Generation failed:', err);
      setIsStreaming(false);
      setStreamingFile(null);
      setStatus('error', err?.message || 'Generation failed');
      addLog(`[Error] ${err?.message || 'Generation failed'}`);
      addMessage({
        role: 'assistant',
        content: `❌ Error: ${err?.message || 'Please check your connection and API key.'}`,
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
    <div className={`${isMinimized ? 'w-12' : 'w-80'} h-full border-r border-zinc-800 bg-zinc-950 flex flex-col shrink-0 select-none transition-all duration-300`}>
      {/* Panel Header */}
      <div className="h-9 px-3 border-b border-zinc-800 flex items-center justify-between text-zinc-400 font-semibold uppercase tracking-wider text-[10px]">
        <div className="flex items-center gap-2">
          {!isMinimized && <span>AI Builder Assistant</span>}
        </div>
        <button
          onClick={() => setIsMinimized(!isMinimized)}
          className="p-1.5 hover:bg-zinc-800 rounded-md transition-colors text-zinc-500 hover:text-zinc-300"
          title={isMinimized ? "Expand chat panel" : "Collapse chat panel"}
        >
          <PanelToggleIcon mirrored={isMinimized} />
        </button>
      </div>

      {/* Messages List */}
      {!isMinimized && (
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
                  <>
                    <V0Stepper
                      steps={msg.steps}
                      filesGenerated={msg.filesGenerated}
                      showPreview={msg.showPreview}
                      content={msg.content}
                    />
                    {msg.screenshot && (
                      <div className="mt-2 rounded-xl overflow-hidden border border-zinc-800 shadow-lg">
                        <div className="px-2.5 py-1.5 bg-zinc-900 border-b border-zinc-800 flex items-center gap-1.5 text-[10px] text-zinc-400">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                          <span>Preview snapshot</span>
                        </div>
                        <img
                          src={msg.screenshot}
                          alt="Preview snapshot"
                          className="w-full block"
                        />
                      </div>
                    )}
                  </>
                ) : (
                  <div className="w-full rounded-xl px-3.5 py-2.5 leading-relaxed bg-zinc-900/90 border border-zinc-800/80 text-zinc-300">
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                    {msg.screenshot && (
                      <div className="mt-2 rounded-xl overflow-hidden border border-zinc-800">
                        <img src={msg.screenshot} alt="Preview snapshot" className="w-full block" />
                      </div>
                    )}
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
      )}

      {/* Prompt Input Area */}
      {!isMinimized && (
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
      )}
    </div>
  );
}
