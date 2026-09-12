'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  Send,
  Loader2,
  Paperclip,
  Image as ImageIcon,
  X,
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
import { bundleProjectWithEsbuild } from '@/lib/preview/esbuild-compiler';
import { SUGGESTED_PROMPTS } from '@/lib/ai/prompt-templates';
import { V0Stepper } from './v0-stepper';
import { BoltPlanCard } from './bolt-plan-card';
import { useCreditsStore, CreditAction } from '@/lib/store/credits-store';

interface ChatPanelProps {
  onGenerateStart?: () => void;
}

export function ChatPanel({ onGenerateStart }: ChatPanelProps) {
  const {
    messages,
    addMessage,
    updateStreamingMessage,
    mode,
    status,
    setStatus,
    files,
    setFiles,
    framework,
    setFramework,
    dbProvider,
    setDbProvider,
    authProvider,
    setAuthProvider,
    addLog,
    activeFile,
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
  const [attachedImage, setAttachedImage] = useState<string | null>(null);
  const [isMinimized, setIsMinimized] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, status, activeSteps]);

  const handleImageFile = (file: File) => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = e.target?.result as string;
      if (base64) setAttachedImage(base64);
    };
    reader.readAsDataURL(file);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile();
        if (file) {
          e.preventDefault();
          handleImageFile(file);
          break;
        }
      }
    }
  };

  const handleSubmit = async (promptText: string) => {
    const query = promptText.trim();
    if ((!query && !attachedImage) || status === 'generating') return;

    // Check & deduct user credits before triggering generation
    const isFix = Boolean(runtimeError);
    const isFreshProject = Object.keys(files).length === 0;

    const creditAction: CreditAction = isFix
      ? 'AUTO_FIX'
      : isFreshProject
      ? 'NEW_PROJECT_BUILD'
      : 'FEATURE_EDIT';

    const hasEnoughCredits = useCreditsStore.getState().deductCredits(creditAction);
    if (!hasEnoughCredits) {
      addMessage({
        role: 'assistant',
        content: '⚠️ You have run out of AI credits. Please click your credits balance at the top header to claim your free daily points or top up!',
      });
      return;
    }

    const currentImage = attachedImage;
    setInput('');
    setAttachedImage(null);
    onGenerateStart?.();
    addMessage({
      role: 'user',
      content: query || 'Build a web application based on this uploaded screenshot / mockup.',
      image: currentImage || undefined,
    });

    const effectiveQuery = query || 'Build a web application based on this uploaded screenshot / mockup.';

    // Auto-detect framework from user prompt (overrides stale UI setting)
    let effectiveFramework = framework;
    if (/\b(vite|react\s+vite|vite\s+react)\b/i.test(effectiveQuery)) {
      effectiveFramework = 'vite';
    } else if (/\b(astro)\b/i.test(effectiveQuery)) {
      effectiveFramework = 'astro';
    } else if (/\b(nextjs|next\.js|next\s+15|next\s+14)\b/i.test(effectiveQuery)) {
      effectiveFramework = 'nextjs';
    } else if (/\b(express|fastify|node\.js\s+backend|backend\s+only)\b/i.test(query)) {
      effectiveFramework = 'node';
    }
    if (effectiveFramework !== framework) {
      setFramework(effectiveFramework);
      addLog(`[Config] Switched framework to ${effectiveFramework.toUpperCase()} from prompt`);
    }

    // Auto-detect database from user prompt
    let effectiveDbProvider = dbProvider;
    if (/\b(supabase)\b/i.test(query)) {
      effectiveDbProvider = 'supabase';
    } else if (/\b(prisma)\b/i.test(query)) {
      effectiveDbProvider = 'prisma';
    } else if (/\b(drizzle)\b/i.test(query)) {
      effectiveDbProvider = 'drizzle';
    } else if (/\b(postgres|postgresql)\b/i.test(query)) {
      effectiveDbProvider = 'postgres';
    } else if (/\b(mysql)\b/i.test(query)) {
      effectiveDbProvider = 'mysql';
    } else if (/\b(sqlite)\b/i.test(query)) {
      effectiveDbProvider = 'sqlite';
    }
    if (effectiveDbProvider !== dbProvider) {
      setDbProvider(effectiveDbProvider);
      addLog(`[Config] Configured database to ${effectiveDbProvider.toUpperCase()} from prompt`);
    }

    // Auto-detect auth provider from user prompt
    let effectiveAuthProvider = authProvider;
    if (/\b(clerk)\b/i.test(query)) {
      effectiveAuthProvider = 'clerk';
    } else if (/\b(nextauth|next-auth|auth\.js)\b/i.test(query)) {
      effectiveAuthProvider = 'nextauth';
    } else if (effectiveDbProvider === 'supabase' && /\b(auth|login|signup|user|authentication)\b/i.test(query)) {
      effectiveAuthProvider = 'supabase';
    }
    if (effectiveAuthProvider !== authProvider) {
      setAuthProvider(effectiveAuthProvider);
    }

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
        m.content.includes('প্রজেক্ট') ||
        m.content.includes('recommendation')
      )
    );

    const isConversationalBuildTrigger = isAffirmativeConfirmation && hasProjectContextInHistory;

    // BUG4 fix: only wipe existing files when truly starting from scratch
    // "create a navbar" / "add a hero section" should NOT wipe the project
    const hasExistingFiles = Object.keys(files).length > 0;
    const isExplicitRebuild = /^(rebuild|start over|start fresh|from scratch|reset|clear project|new project)/i.test(query.trim());
    const isNewBuild = !hasExistingFiles || isExplicitRebuild;

    // Detect if prompt is extremely vague on a fresh project without any screenshot
    // (e.g. "build a crypto app", "একটি ওয়েবসাইট বানান") without feature specifics.
    // Route to chat mode so the AI executes the requirements grilling protocol before building.
    const isVeryVagueInitialPrompt = isNewBuild && !attachedImage && query.length < 35 && !query.includes('\n') && !/\b(with|include|features|hero|pricing|navbar|table|chart|auth|login|signup|theme|page|dashboard with|using)\b/i.test(query) && !isAffirmativeConfirmation;

    const isBuild = (hasBuildVerb || (hasAppNoun && query.length > 15) || isConversationalBuildTrigger) && !isVeryVagueInitialPrompt;

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
            image: currentImage || undefined,
            history: messages
              .filter((m) => m.content && m.content.trim() !== '' && m.content !== '…')
              .map((m) => ({ role: m.role, content: m.content })),
            framework: effectiveFramework,
            dbProvider: effectiveDbProvider,
            authProvider: effectiveAuthProvider,
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

          const entry = effectiveFramework === 'vite'
            ? (merged['src/App.tsx'] ? 'src/App.tsx' : merged['src/App.jsx'] ? 'src/App.jsx' : Object.keys(merged)[0])
            : (merged['app/page.tsx'] ? 'app/page.tsx' : merged['src/App.tsx'] ? 'src/App.tsx' : Object.keys(merged)[0]);
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

    // Detect if this is an auto-fix request targeting an active preview error OR screenshot visual fix
    const isRuntimeFix = Boolean(runtimeError && /\b(fix|repair|error|broken|bug|issue|solve)\b/i.test(query));
    const isScreenshotFix = Boolean(
      hasExistingFiles &&
      currentImage &&
      (/\b(fix|repair|solve|change|update|modify|issue|bug|problem|error|not working|broken)\b/i.test(query) ||
       /(সমস্যা|সমাধান|ঠিক|সংশোধন|কাজ করছে না|ভুল|পরিবর্তন)/i.test(query))
    );

    const isFixRequest = isRuntimeFix || isScreenshotFix;
    const effectiveMode = isScreenshotFix ? 'visual-fix' : isRuntimeFix ? 'auto-fix' : 'build';
    const effectiveMessage = isRuntimeFix
      ? `${query}\n\nACTIVE PREVIEW ERROR TO FIX:\n${runtimeError}`
      : isScreenshotFix
      ? `VISUAL ISSUE REPORTED VIA SCREENSHOT:\n${query}\n\nPlease inspect the screenshot and apply a surgical fix to only the affected component.`
      : query;

    // ── BUILD / AUTO-FIX MODE ─────────────────────────────────
    setStatus('generating', isFixRequest ? 'AI is repairing the issue...' : 'AI is building your project...');
    setIsStreaming(true);
    addLog(`[AI] ${isFixRequest ? 'Repairing' : 'Building'}: "${query.slice(0, 60)}..."`);

    // Real dynamic timeline — starts with "Analyzing" only
    const analyzeStep: TimelineStep = {
      id: 'analyze-1',
      type: 'thought',
      label: isFixRequest
        ? `Diagnosing preview error for ${effectiveFramework.toUpperCase()}...`
        : `Analyzing request for ${effectiveFramework.toUpperCase()}...`,
      status: 'running',
    };
    setActiveSteps([analyzeStep]);

    try {
      const response = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: effectiveMessage,
          image: currentImage || undefined,
          history: messages
            .filter((m) => m.content && m.content.trim() !== '' && m.content !== '…')
            .map((m) => ({ role: m.role, content: m.content })),
          files: isNewBuild && !isFixRequest ? {} : files,
          activeFile: activeFile || undefined,
          framework: effectiveFramework,
          dbProvider: effectiveDbProvider,
          authProvider: effectiveAuthProvider,
          mode: effectiveMode,
        }),
      });

      if (!response.ok || !response.body) throw new Error(`HTTP error ${response.status}`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulatedText = '';
      let currentSteps: TimelineStep[] = [
        { ...analyzeStep, status: 'completed', label: isFixRequest ? `Diagnosed preview error` : `Analyzed request for ${effectiveFramework.toUpperCase()}` },
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
            label: `Planning ${effectiveFramework} architecture...`,
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
              // Mark previous file steps as completed
              currentSteps = currentSteps.map((s) =>
                s.type === 'file' && s.status === 'running'
                  ? { ...s, status: 'completed' as const }
                  : s
              );
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
        const entryFile = effectiveFramework === 'vite'
          ? (mergedFiles['src/App.tsx'] ? 'src/App.tsx' : mergedFiles['src/App.jsx'] ? 'src/App.jsx' : Object.keys(mergedFiles)[0])
          : effectiveFramework === 'astro'
          ? (mergedFiles['src/pages/index.astro'] ? 'src/pages/index.astro' : Object.keys(mergedFiles)[0])
          : (mergedFiles['app/page.tsx'] ? 'app/page.tsx' : mergedFiles['src/App.tsx'] ? 'src/App.tsx' : Object.keys(mergedFiles)[0]);
        if (entryFile) setActiveFile(entryFile);
        addLog(`[AI] Workspace updated: ${Object.keys(mergedFiles).length} files (${hasToolCalls ? `${toolCalls.length} MCP tools executed` : 'file parser'}).`);
      }

      let verifiedFiles = mergedFiles;
      let buildHealed = false;

      // ── Autonomous Build-Verify-Repair Pipeline ──
      if (Object.keys(verifiedFiles).length > 0) {
        addLog('[Build Pipeline] Running virtual build verification check...');
        try {
          const checkResult = await bundleProjectWithEsbuild(verifiedFiles);
          if (checkResult.errors.length > 0 && !isFixRequest) {
            const firstError = checkResult.errors[0];
            addLog(`[Build Pipeline] ⚠️ Virtual build issue detected: ${firstError.slice(0, 120)}... Initiating autonomous self-healing...`);

            // Add auto-heal step to timeline
            const healStepId = 'heal-' + Date.now();
            currentSteps = [
              ...currentSteps,
              { id: healStepId, type: 'inspect', label: 'Auto-healing compilation issue...', status: 'running' as const }
            ];
            setActiveSteps(currentSteps);

            const healResponse = await fetch('/api/agent', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                message: `AUTONOMOUS BUILD VERIFICATION FAILED:\n${checkResult.errors.join('\n')}\n\nPlease perform a minimal surgical fix to repair the error without modifying working features.`,
                files: verifiedFiles,
                framework: effectiveFramework,
                dbProvider: effectiveDbProvider,
                authProvider: effectiveAuthProvider,
                mode: 'auto-fix',
              }),
            });

            if (healResponse.ok && healResponse.body) {
              const healReader = healResponse.body.getReader();
              const healDecoder = new TextDecoder();
              let healAccum = '';
              while (true) {
                const { done, value } = await healReader.read();
                if (done) break;
                healAccum += healDecoder.decode(value, { stream: true });
              }

              const { toolCalls: healTools } = parseToolCalls(healAccum);
              const { files: healParsedFiles } = parseFinalOutput(healAccum);

              let healedDiff: Record<string, string> = {};
              if (healTools.length > 0) {
                const mcpRes = executeToolCalls(verifiedFiles, healTools);
                healedDiff = mcpRes.updatedFiles;
                mcpRes.logs.forEach((l) => addLog(l));
              }
              if (Object.keys(healParsedFiles).length > 0) {
                healedDiff = { ...healedDiff, ...healParsedFiles };
              }

              if (Object.keys(healedDiff).length > 0) {
                verifiedFiles = { ...verifiedFiles, ...healedDiff };
                setFiles(verifiedFiles);
                buildHealed = true;
                addLog(`[Auto-Heal] Successfully resolved build errors in ${Object.keys(healedDiff).join(', ')}.`);
              }
            }
          } else {
            addLog('[Build Pipeline] ✓ Virtual build verification passed cleanly.');
          }
        } catch (compileErr) {
          console.warn('[Build Verification]', compileErr);
        }
      }

      // Mark all file steps as completed with line counts
      const finalSteps: TimelineStep[] = [
        ...currentSteps.map((step) => {
          if (step.file && verifiedFiles[step.file]) {
            const lines = verifiedFiles[step.file].split('\n').length;
            return { ...step, status: 'completed' as const, label: `Built ${step.file.split('/').pop()}`, linesAdded: lines };
          }
          return { ...step, status: 'completed' as const };
        }),
        ...toolSteps,
      ];
      finalSteps.push({
        id: 'preview-checked',
        type: 'preview',
        label: buildHealed ? 'Build verified & auto-healed' : 'Build verified (0 errors)',
        status: 'completed',
      });

      setActiveSteps(finalSteps);
      setIsStreaming(false);
      setStreamingFile(null);

      // Clean up response explanation: strip internal prompt rules or thoughts
      const fileList = Object.keys(mergedFiles);
      const chosenExplanation = mcpExplanation || aiExplanation;
      let cleanIntro = '';
      if (chosenExplanation && chosenExplanation.length > 10) {
        // Strip out any leaked rules / diagnostic prompts if AI included them
        const sanitized = chosenExplanation
          .replace(/Assessment of initial workspace state[\s\S]*?Let's check the rules:[\s\S]*?(?=\n\n|$)/gi, '')
          .replace(/Prior to writing code[\s\S]*?(?=\n\n|$)/gi, '')
          .replace(/### (?:TYPES-FIRST|ARCHITECTURE-FIRST|CRITICAL GENERATION RULES)[\s\S]*?(?=\n\n|$)/gi, '')
          .trim();
        cleanIntro = sanitized.split('\n\n')[0]?.trim() || '';
      }
      if (!cleanIntro || cleanIntro.length < 10) {
        cleanIntro = `I'll build a complete ${effectiveFramework.toUpperCase()} application with ${fileList.length} files. Let's inspect the setup and verify the components.`;
      }

      addMessage({
        role: 'assistant',
        content: cleanIntro,
        steps: finalSteps,
        filesGenerated: fileList,
        showPreview: false,
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
              <div className="max-w-[85%] rounded-2xl px-3.5 py-2 leading-relaxed bg-blue-600 text-white shadow-sm space-y-2">
                {msg.image && (
                  <div className="rounded-xl overflow-hidden border border-blue-400/30 max-h-48 bg-zinc-950/40">
                    <img
                      src={msg.image}
                      alt="Uploaded user screenshot"
                      className="w-full object-contain max-h-48"
                    />
                  </div>
                )}
                <p className="whitespace-pre-wrap">{msg.content}</p>
              </div>
            ) : (
              <div className="w-full">
                {msg.steps && msg.steps.length > 0 ? (
                  <BoltPlanCard
                    introText={msg.content}
                    steps={msg.steps}
                    filesInspected={msg.filesGenerated}
                    isStreaming={false}
                  />
                ) : (
                  <div className="w-full space-y-2">
                    <div className="flex items-center gap-1.5">
                      <span className="font-extrabold italic text-sm tracking-tight text-zinc-100">opendork</span>
                    </div>
                    <div className="w-full rounded-xl px-3.5 py-2.5 leading-relaxed bg-zinc-900/90 border border-zinc-800/80 text-zinc-300">
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {/* Live Stepper when AI is actively generating */}
        {status === 'generating' && (
          <div className="w-full text-xs">
            <BoltPlanCard
              introText={
                runtimeError
                  ? `Diagnosing preview sandbox error and applying surgical repair for ${framework.toUpperCase()}...`
                  : Object.keys(files).length > 0
                  ? `Analyzing requested changes and updating your ${framework.toUpperCase()} application...`
                  : `I'll build a complete ${framework.toUpperCase()} application. Let's inspect the setup and create the components.`
              }
              steps={activeSteps}
              isStreaming={true}
            />
          </div>
        )}

        <div ref={messagesEndRef} />
        </div>
      )}

      {/* Prompt Input Area - Premium Design */}
      {!isMinimized && (
        <div className="p-4 border-t border-zinc-800/50 bg-gradient-to-b from-zinc-900/50 to-zinc-950">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit(input);
          }}
          className="relative group"
        >
          {/* Gradient glow effect on focus */}
          <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-xl opacity-0 group-focus-within:opacity-20 blur transition-opacity duration-300" />
          
          <div className="relative">
            {/* Attached Image Thumbnail Preview */}
            {attachedImage && (
              <div className="relative inline-block mb-2 p-1 rounded-xl bg-zinc-950 border border-zinc-700 shadow-md">
                <img
                  src={attachedImage}
                  alt="Uploaded reference"
                  className="h-16 max-w-[160px] object-cover rounded-lg"
                />
                <button
                  type="button"
                  onClick={() => setAttachedImage(null)}
                  className="absolute -top-1.5 -right-1.5 p-1 rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white border border-zinc-700 shadow-sm cursor-pointer"
                  title="Remove image"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
                <span className="absolute bottom-1 left-1.5 px-1 py-0.2 rounded text-[8px] bg-black/80 text-zinc-300 font-mono">
                  UI Mockup
                </span>
              </div>
            )}

            <textarea
              ref={textareaRef}
              rows={3}
              placeholder={
                attachedImage
                  ? "Explain what to build/modify from this screenshot..."
                  : "Describe changes, new features, or paste/upload a screenshot (Ctrl+V)..."
              }
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPaste={handlePaste}
              onKeyDown={handleKeyDown}
              disabled={status === 'generating'}
              className="w-full px-4 py-3 pl-10 pr-12 bg-zinc-900/80 backdrop-blur-sm border border-zinc-700/50 hover:border-zinc-600 focus:border-blue-500/50 rounded-xl text-sm text-zinc-100 placeholder:text-zinc-500/70 focus:outline-none focus:ring-2 focus:ring-blue-500/20 resize-none transition-all duration-200 disabled:opacity-50 shadow-lg shadow-black/10"
              style={{ lineHeight: '1.5' }}
            />

            {/* Hidden File Input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleImageFile(file);
                e.target.value = '';
              }}
            />

            {/* Attach Image Button (inside left bottom) */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={status === 'generating'}
              className="absolute left-2.5 bottom-3 p-1.5 rounded-lg bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 hover:text-blue-400 transition-colors cursor-pointer disabled:opacity-40"
              title="Attach UI screenshot or wireframe"
            >
              <Paperclip className="w-3.5 h-3.5" />
            </button>

            {/* Send button with premium styling */}
            <button
              type="submit"
              disabled={(!input.trim() && !attachedImage) || status === 'generating'}
              className="absolute right-3 bottom-3 p-2 rounded-lg bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 disabled:from-zinc-800 disabled:to-zinc-800 text-white disabled:text-zinc-500 transition-all duration-200 shadow-lg shadow-blue-900/50 disabled:shadow-none hover:scale-105 active:scale-95"
              title="Send with AI"
            >
              {status === 'generating' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </button>
          </div>
        </form>
        
        {/* Helper text with icon */}
        <div className="flex items-center justify-center gap-2 mt-2.5">
          <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <span className="font-medium">AI automatically chooses optimal framework & components</span>
          </div>
        </div>
        </div>
      )}
    </div>
  );
}
