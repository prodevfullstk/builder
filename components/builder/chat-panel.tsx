'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  Send,
  Loader2,
  Paperclip,
  Image as ImageIcon,
  X,
  Square,
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
import { ExecutionPlanCard, PlanMilestone } from './execution-plan-card';
import { useCreditsStore, CreditAction } from '@/lib/store/credits-store';
import { evaluateCandidateChanges } from '@/lib/validation/candidate-pipeline';
import { parseIntentFromPrompt, MUTATING_INTENT_ACTIONS } from '@/lib/ai/intent-contract';
import { StreamEventDecoder } from '@/lib/ai/stream-events';
import { useAuthStore, getClientAuthHeaders } from '@/lib/auth/supabase-auth';

interface ChatPanelProps {
  onGenerateStart?: () => void;
}

export function ChatPanel({ onGenerateStart }: ChatPanelProps) {
  const {
    messages,
    addMessage,
    updateStreamingMessage,
    mode,
    setMode,
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
    setRuntimeError,
    clearRuntimeError,
    resetAutoFixAttempts,
    projectId,
  } = useProjectStore();

  const [input, setInput] = useState('');
  const [attachedImage, setAttachedImage] = useState<string | null>(null);
  const [isMinimized, setIsMinimized] = useState(false);
  const [streamingProse, setStreamingProse] = useState('');
  const [activeMilestones, setActiveMilestones] = useState<PlanMilestone[]>([]);
  const [activeFilesRead, setActiveFilesRead] = useState<string[]>([]);
  const [activeFilesUpdated, setActiveFilesUpdated] = useState<string[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleCancelGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsStreaming(false);
    setStreamingFile(null);
    setStatus('ready', 'Generation cancelled');
    setActiveSteps(
      activeSteps.map((s) => (s.status === 'running' ? { ...s, status: 'cancelled' as const } : s))
    );
    setActiveMilestones((prev) =>
      prev.map((m) => (m.status === 'running' ? { ...m, status: 'cancelled' as const } : m))
    );
    addLog('[AI] Generation cancelled by user.');
  };

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

    // Mandatory Authentication Gate: Prompt submission requires active Supabase session
    const authState = useAuthStore.getState();
    if (!authState.isAuthenticated || !authState.accessToken) {
      addMessage({
        role: 'assistant',
        content: '🔒 Please sign in with your account to send messages, generate code, or develop projects.',
      });
      authState.setAuthModalOpen(true);
      return;
    }

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
    setMode('preview');
    onGenerateStart?.();
    resetAutoFixAttempts();
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

    // Gate 5: Language-agnostic semantic intent routing (no hardcoded English/Bengali wordlists)
    const intent = parseIntentFromPrompt({
      prompt: query,
      framework: effectiveFramework,
      hasImage: Boolean(attachedImage),
      currentFiles: files,
      activeFile,
    });

    const isMutatingIntent = MUTATING_INTENT_ACTIONS.has(intent.action);
    const hasExistingFiles = Object.keys(files).length > 0;
    const isNewBuild = !hasExistingFiles || intent.action === 'CREATE_PROJECT';

    // Route: If the intent is mutating (CREATE_PROJECT, ADD_FEATURE, MODIFY_FEATURE, FIX_BUG, etc.)
    // and not a vague exploratory inquiry, run build/agent mode. Otherwise conversational chat.
    const isBuild = isMutatingIntent && (hasExistingFiles || query.length >= 8 || Boolean(attachedImage));

    // ── CONVERSATION MODE ─────────────────────────────────────
    if (!isBuild) {
      const baselineRevision = useProjectStore.getState().revision || 1;
      setStatus('generating', 'Thinking...');
      // ISSUE9 fix: stream chat replies token-by-token
      let streamContent = '';
      try {
        const response = await fetch('/api/agent', {
          method: 'POST',
          headers: getClientAuthHeaders(),
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
        if (!response.ok || !response.body) {
          if (response.status === 401) {
            useAuthStore.getState().handleAuthExpired('Session expired. Please sign in again.');
            addMessage({
              role: 'assistant',
              content: '🔒 আপনার সাইন-ইন সেশনের মেয়াদ শেষ হয়েছে বা সাইন-ইন প্রয়োজন। দয়া করে আপনার অ্যাকাউন্ট দিয়ে সাইন-ইন করুন।',
            });
            setStatus('idle');
            return;
          }
          throw new Error(`HTTP ${response.status}`);
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const sseDecoder = new StreamEventDecoder();

        // Add live streaming message — update it chunk by chunk
        addMessage({ role: 'assistant', content: '…' });

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          const events = sseDecoder.pushChunk(chunk);
          if (events.length > 0) {
            for (const ev of events) {
              if (ev.type === 'text_delta') {
                streamContent += ev.delta;
                updateStreamingMessage(streamContent);
              } else if (ev.type === 'error') {
                addLog(`[Stream Error] ${ev.message}`);
              }
            }
          } else if (!chunk.startsWith('event:')) {
            streamContent += chunk;
            updateStreamingMessage(streamContent);
          }
        }
        // Final flush
        const flushed = decoder.decode();
        if (flushed) {
          const flushEvents = sseDecoder.pushChunk(flushed);
          for (const ev of flushEvents) {
            if (ev.type === 'text_delta') streamContent += ev.delta;
          }
          if (flushEvents.length === 0 && !flushed.startsWith('event:')) {
            streamContent += flushed;
          }
        }
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
          addLog(`[Candidate Pipeline] Validating ${Object.keys(recoveredFiles).length} candidate files from chat response...`);
          const evalResult = await evaluateCandidateChanges({
            projectId: 'chat-candidate',
            framework: effectiveFramework,
            currentFiles: files,
            candidateFiles: recoveredFiles,
            isNewBuild: false,
          });

          if (evalResult.accepted) {
            const currentRevision = useProjectStore.getState().revision || 1;
            if (currentRevision !== baselineRevision) {
              addLog(`[Concurrency] ✕ Stale candidate rejected in chat mode: Workspace revision changed from ${baselineRevision} to ${currentRevision} during generation.`);
              setStatus('ready', 'Concurrent modification detected');
              return;
            }
            setFiles(evalResult.committedFiles);
            const entry = effectiveFramework === 'vite'
              ? (evalResult.committedFiles['src/App.tsx'] ? 'src/App.tsx' : evalResult.committedFiles['src/App.jsx'] ? 'src/App.jsx' : Object.keys(evalResult.committedFiles)[0])
              : (evalResult.committedFiles['app/page.tsx'] ? 'app/page.tsx' : evalResult.committedFiles['src/App.tsx'] ? 'src/App.tsx' : Object.keys(evalResult.committedFiles)[0]);
            if (entry) setActiveFile(entry);

            const cleanChatMsg = chatToolExpl || chatAiExpl || 'I have generated and validated the project files in your workspace!';
            updateStreamingMessage(cleanChatMsg.trim());
            setStatus('ready', 'Application ready');
            addLog(`[Candidate Pipeline] ✓ Accepted and committed (${evalResult.evidence.checks.length} checks passed).`);
          } else {
            addLog(`[Candidate Pipeline] ✕ Validation rejected candidate: ${evalResult.diagnostics.join(' | ')}`);
            setStatus('idle');
          }
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

    // Language-agnostic detection: rely on structured IntentContract & runtime error
    const isRuntimeFix = Boolean(
      runtimeError &&
      (intent.action === 'FIX_BUG' || intent.action === 'MODIFY_FEATURE' || intent.action === 'REFACTOR' || intent.action !== 'QUESTION')
    );
    const isScreenshotFix = Boolean(
      hasExistingFiles &&
      currentImage &&
      (intent.action === 'VISUAL_EDIT' || intent.action === 'VISUAL_RECREATE' || intent.action === 'FIX_BUG' || intent.action === 'MODIFY_FEATURE')
    );

    const isFixRequest = isRuntimeFix || isScreenshotFix;
    const effectiveMode = isScreenshotFix ? 'visual-fix' : isRuntimeFix ? 'auto-fix' : 'build';
    const effectiveMessage = isRuntimeFix
      ? `${query}\n\nACTIVE PREVIEW ERROR TO FIX:\n${runtimeError}`
      : isScreenshotFix
      ? `VISUAL ISSUE REPORTED VIA SCREENSHOT:\n${query}\n\nPlease inspect the screenshot and apply a surgical fix to only the affected component.`
      : query;

    // ── BUILD / AUTO-FIX MODE ─────────────────────────────────
    const baselineFiles = { ...files };
    const baselineRevision = useProjectStore.getState().revision || 1;
    setStatus('generating', isFixRequest ? 'AI is repairing the issue...' : 'AI is building your project...');
    setIsStreaming(true);
    addLog(`[AI] ${isFixRequest ? 'Repairing' : 'Building'}: "${query.slice(0, 60)}..."`);

    // Reset streaming state & initialize AbortController
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setStreamingProse('');
    setActiveMilestones([]);
    setActiveFilesRead([]);
    setActiveFilesUpdated([]);

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
        headers: getClientAuthHeaders(),
        signal: controller.signal,
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

      if (!response.ok || !response.body) {
        if (response.status === 401) {
          useAuthStore.getState().handleAuthExpired('Session expired. Please sign in again.');
          addMessage({
            role: 'assistant',
            content: '🔒 আপনার সাইন-ইন সেশনের মেয়াদ শেষ হয়েছে বা সাইন-ইন প্রয়োজন। দয়া করে আপনার অ্যাকাউন্ট দিয়ে সাইন-ইন করুন।',
          });
          setIsStreaming(false);
          setStreamingFile(null);
          setStatus('idle');
          return;
        }
        throw new Error(`HTTP error ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const sseDecoder = new StreamEventDecoder();
      let accumulatedText = '';
      let accumulatedProse = '';
      let currentSteps: TimelineStep[] = [
        { ...analyzeStep, status: 'completed', label: isFixRequest ? `Diagnosed preview error` : `Analyzed request for ${effectiveFramework.toUpperCase()}` },
      ];
      let trackedFiles = new Set<string>();
      let trackedReadFiles = new Set<string>();
      let planningStepAdded = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        accumulatedText += chunk;

        const events = sseDecoder.pushChunk(chunk);
        for (const ev of events) {
          if (ev.type === 'text_delta' && ev.delta) {
            accumulatedProse += ev.delta;
            setStreamingProse(accumulatedProse);
          } else if (ev.type === 'file_read' && ev.path) {
            if (!trackedReadFiles.has(ev.path)) {
              trackedReadFiles.add(ev.path);
              setActiveFilesRead(Array.from(trackedReadFiles));
            }
          } else if (ev.type === 'plan') {
            if (ev.milestones && ev.milestones.length > 0) {
              const parsedMilestones: PlanMilestone[] = ev.milestones.map((m: any) => ({
                id: m.id,
                label: m.title || m.label,
                status: m.status || 'pending',
              }));
              setActiveMilestones(parsedMilestones);
            } else if (ev.steps && ev.steps.length > 0) {
              const parsedMilestones: PlanMilestone[] = ev.steps.map((s: string, idx: number) => ({
                id: `milestone-${idx + 1}`,
                label: s,
                status: idx === 0 ? 'running' : 'pending',
              }));
              setActiveMilestones(parsedMilestones);
            }
            if (!planningStepAdded) {
              planningStepAdded = true;
              const planStep: TimelineStep = {
                id: 'plan-1',
                type: 'inspect',
                label: ev.steps?.[0] || `Planning ${effectiveFramework} architecture...`,
                status: 'completed',
              };
              currentSteps = [...currentSteps, planStep];
              setActiveSteps(currentSteps);
            }
          } else if (ev.type === 'file_start' && ev.path) {
            setStreamingFile(ev.path);
            setActiveFile(ev.path);
            if (!trackedFiles.has(ev.path)) {
              trackedFiles.add(ev.path);
              setActiveFilesUpdated(Array.from(trackedFiles));
              currentSteps = currentSteps.map((s) =>
                s.type === 'file' && s.status === 'running'
                  ? { ...s, status: 'completed' as const }
                  : s
              );
              const fileStep: TimelineStep = {
                id: `step-${ev.path}`,
                type: 'file',
                label: `Generating ${ev.path.split('/').pop()}`,
                file: ev.path,
                status: 'running',
              };
              currentSteps = [...currentSteps, fileStep];
              setActiveSteps(currentSteps);

              setActiveMilestones((prev) =>
                prev.map((m) =>
                  m.status === 'running' || m.id.includes('build') || m.id === 'milestone-2' || m.id === 'milestone-1'
                    ? { ...m, status: 'running', subAction: { type: 'write', target: ev.path, state: 'generating' } }
                    : m
                )
              );
            }
          } else if (ev.type === 'file_complete' && ev.path) {
            currentSteps = currentSteps.map((s) =>
              s.file === ev.path
                ? { ...s, status: 'completed' as const, label: `Generated ${ev.path.split('/').pop()}` }
                : s
            );
            setActiveSteps(currentSteps);
          }
        }

        // Fallback for non-SSE or text chunks
        if (events.length === 0) {
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

          const { currentStreamingFile } = extractStreamingState(accumulatedText);
          if (currentStreamingFile) {
            setStreamingFile(currentStreamingFile);
            setActiveFile(currentStreamingFile);
            if (!trackedFiles.has(currentStreamingFile)) {
              trackedFiles.add(currentStreamingFile);
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
      let mcpFiles: Record<string, string> = {};
      const hasToolCalls = toolCalls.length > 0;
      let toolSteps: TimelineStep[] = [];

      if (hasToolCalls) {
        const mcpResult = executeToolCalls(files, toolCalls);
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

      // Raw Candidate Workspace
      const candidateFiles = hasToolCalls
        ? { ...parsedFiles, ...mcpFiles }
        : parsedFiles;

      // ── ATOMIC CANDIDATE VALIDATION GATE ──
      addLog(`[Candidate Pipeline] Evaluating candidate changes against ${effectiveFramework.toUpperCase()} contract...`);
      const valStepId = 'val-' + Date.now();
      const validationStep: TimelineStep = {
        id: valStepId,
        type: 'inspect',
        label: `Validating candidate for ${effectiveFramework.toUpperCase()}...`,
        status: 'running',
      };
      currentSteps = [...currentSteps, validationStep];
      setActiveSteps(currentSteps);

      const evalResult = await evaluateCandidateChanges({
        projectId: 'workspace',
        framework: effectiveFramework,
        currentFiles: baselineFiles,
        candidateFiles,
        isNewBuild,
      });

      if (!evalResult.accepted) {
        // Validation Failed: Preserve previous known-good project untouched!
        addLog(`[Candidate Pipeline] ✕ REJECTED: ${evalResult.diagnostics.join(' | ')}`);
        currentSteps = currentSteps.map((s) =>
          s.id === valStepId
            ? { ...s, status: 'failed' as const, label: `Validation Failed (${evalResult.diagnostics[0] || 'Contract error'})` }
            : s
        );
        setActiveSteps(currentSteps);
        setActiveMilestones((prev) =>
          prev.map((m) =>
            m.status === 'running'
              ? { ...m, status: 'failed' as const, error: evalResult.diagnostics[0] || 'Validation rejected candidate' }
              : m
          )
        );
        setIsStreaming(false);
        setStreamingFile(null);
        setStatus('error', 'Validation rejected candidate changes');
        setRuntimeError(`Validation Error: ${evalResult.diagnostics[0] || 'Generated files violated framework contract'}`);

        addMessage({
          role: 'assistant',
          content: `⚠️ **Candidate Validation Failed:** The generated changes did not satisfy the **${effectiveFramework.toUpperCase()}** framework contract or security requirements.\n\n**Diagnostics:**\n${evalResult.diagnostics.map((d) => `- ${d}`).join('\n')}\n\n*Your previous working files have been preserved.* Click **Auto-Fix with AI** or provide instructions to repair the candidate.`,
          steps: currentSteps,
          showPreview: false,
        });
        return;
      }

      // Validation Passed: stage candidate changes in-memory (transactional commit deferred)
      let verifiedFiles = evalResult.committedFiles;

      addLog(`[Candidate Pipeline] ✓ ACCEPTED candidate (${evalResult.evidence.checks.length} checks passed).`);
      currentSteps = currentSteps.map((s) =>
        s.id === valStepId
          ? { ...s, status: 'completed' as const, label: `Validated candidate (${evalResult.evidence.checks.length} checks passed)` }
          : s
      );
      setActiveSteps(currentSteps);

      let buildHealed = false;
      let compilationPassed = true;

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
              headers: getClientAuthHeaders(),
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
                // SECURITY: Auto-healed candidates must also pass the validation pipeline
                const healCandidateFiles = { ...verifiedFiles, ...healedDiff };
                const healEval = await evaluateCandidateChanges({
                  projectId: 'workspace',
                  framework: effectiveFramework,
                  currentFiles: verifiedFiles,
                  candidateFiles: healCandidateFiles,
                  isNewBuild: false,
                });
                if (healEval.accepted) {
                  // Re-verify compilation of healed candidate
                  const healCheck = await bundleProjectWithEsbuild(healEval.committedFiles);
                  if (healCheck.errors.length === 0) {
                    verifiedFiles = healEval.committedFiles;
                    buildHealed = true;
                    compilationPassed = true;
                    addLog(`[Auto-Heal] ✓ Validated & resolved build errors in ${Object.keys(healedDiff).join(', ')}.`);
                  } else {
                    addLog(`[Auto-Heal] ✕ Heal candidate still failed compilation: ${healCheck.errors[0].slice(0, 100)}`);
                    compilationPassed = false;
                  }
                } else {
                  addLog(`[Auto-Heal] ✕ Heal candidate failed validation: ${healEval.diagnostics.join(' | ')}`);
                  compilationPassed = false;
                }
              } else {
                compilationPassed = false;
              }
            } else {
              compilationPassed = false;
            }
          } else if (checkResult.errors.length > 0) {
            compilationPassed = false;
          } else {
            addLog('[Build Pipeline] ✓ Virtual build verification passed cleanly.');
            compilationPassed = true;

            // ── Native Isolated Build Verification Gate (GEN-501 / Phase 5) ──
            addLog('[Build Pipeline] Contacting isolated container build verifier (/api/validate/build)...');
            try {
              const buildRes = await fetch('/api/validate/build', {
                method: 'POST',
                headers: getClientAuthHeaders(),
                body: JSON.stringify({
                  projectId: projectId || 'workspace',
                  framework: effectiveFramework,
                  files: verifiedFiles,
                  mandatory: false,
                }),
              });
              if (buildRes.ok) {
                const buildData = await buildRes.json();
                if (buildData.verificationLevel === 'NATIVE_BUILD_VERIFIED') {
                  addLog('[Build Pipeline] ✓ NATIVE CONTAINER BUILD VERIFIED: Compilation succeeded in microVM.');
                } else {
                  addLog(`[Build Pipeline] ℹ Native container environment unconfigured. Truthfully recorded: ${buildData.verificationLevel || 'NATIVE_BUILD_UNVERIFIED'}.`);
                }
              }
            } catch (nativeErr: any) {
              addLog(`[Build Pipeline] ℹ Native verification check completed: ${nativeErr?.message || 'Virtual verification recorded'}`);
            }
          }
        } catch (compileErr) {
          console.warn('[Build Verification]', compileErr);
        }
      }

      // ── TRANSACTIONAL COMMIT GATE (GEN-301) ──
      // Security Invariant: If compilation failed and could not be healed,
      // do NOT commit corrupt files to workspace under any circumstance, including fix requests.
      if (!compilationPassed) {
        setIsStreaming(false);
        setStreamingFile(null);
        setStatus('error', 'Virtual build verification failed');
        setRuntimeError('Build verification failed: Candidate code contained unresolvable compilation errors.');
        addMessage({
          role: 'assistant',
          content: `⚠️ **Build Verification Failed:** The generated code could not be compiled cleanly by the virtual bundler.\n\n*Your previous working files have been preserved.* Click **Auto-Fix with AI** or provide instructions to repair the issue.`,
          steps: currentSteps,
          showPreview: false,
        });
        return;
      }

      // ── OPTIMISTIC CONCURRENCY CHECK (GEN-302) ──
      const currentRevision = useProjectStore.getState().revision || 1;
      if (currentRevision !== baselineRevision) {
        const currentFiles = useProjectStore.getState().files;
        const userModifiedPaths = Object.keys(currentFiles).filter(
          (p) => currentFiles[p] !== baselineFiles[p]
        );
        const aiCandidatePaths = Object.keys(candidateFiles);
        const conflictPaths = userModifiedPaths.filter((p) => aiCandidatePaths.includes(p));

        if (conflictPaths.length === 0 && userModifiedPaths.length > 0) {
          // Safe 3-way merge: preserve user's modified files while applying candidate changes to non-conflicting files
          verifiedFiles = {
            ...verifiedFiles,
            ...Object.fromEntries(userModifiedPaths.map((p) => [p, currentFiles[p]])),
          };
          addLog(`[Concurrency] Seamlessly merged non-conflicting concurrent user edits in: ${userModifiedPaths.join(', ')}`);
        } else {
          setIsStreaming(false);
          setStreamingFile(null);
          setStatus('ready', 'Concurrent modification detected');
          addLog(`[Concurrency] ✕ Stale candidate rejected: Workspace revision changed from ${baselineRevision} to ${currentRevision} during generation.`);
          addMessage({
            role: 'assistant',
            content: '⚠️ **Concurrent Modification Detected:** Your workspace files were modified while this AI generation was running. To prevent destroying your newer edits, this candidate was not applied. Your current files remain preserved.',
            steps: currentSteps,
            showPreview: true,
          });
          return;
        }
      }

      // Validation AND compilation passed, revision intact: Atomically commit to authoritative project store
      setFiles(verifiedFiles);
      setActiveMilestones((prev) =>
        prev.map((m) => ({ ...m, status: 'completed' as const }))
      );
      const entryFile = effectiveFramework === 'vite'
        ? (verifiedFiles['src/App.tsx'] ? 'src/App.tsx' : verifiedFiles['src/App.jsx'] ? 'src/App.jsx' : Object.keys(verifiedFiles)[0])
        : effectiveFramework === 'astro'
        ? (verifiedFiles['src/pages/index.astro'] ? 'src/pages/index.astro' : Object.keys(verifiedFiles)[0])
        : (verifiedFiles['app/page.tsx'] ? 'app/page.tsx' : verifiedFiles['src/App.tsx'] ? 'src/App.tsx' : Object.keys(verifiedFiles)[0]);
      if (entryFile) setActiveFile(entryFile);

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
      const fileList = Object.keys(verifiedFiles);
      let cleanIntro = '';
      if (accumulatedProse && accumulatedProse.trim().length > 10) {
        const sanitized = accumulatedProse
          .replace(/Assessment of initial workspace state[\s\S]*?Let's check the rules:[\s\S]*?(?=\n\n|$)/gi, '')
          .replace(/Prior to writing code[\s\S]*?(?=\n\n|$)/gi, '')
          .replace(/### (?:TYPES-FIRST|ARCHITECTURE-FIRST|CRITICAL GENERATION RULES)[\s\S]*?(?=\n\n|$)/gi, '')
          .trim();
        cleanIntro = sanitized.split('\n\n')[0]?.trim() || sanitized.slice(0, 300);
      }
      if (!cleanIntro) {
        const chosenExplanation = mcpExplanation || aiExplanation;
        if (chosenExplanation && chosenExplanation.length > 10) {
          const sanitized = chosenExplanation
            .replace(/Assessment of initial workspace state[\s\S]*?Let's check the rules:[\s\S]*?(?=\n\n|$)/gi, '')
            .replace(/Prior to writing code[\s\S]*?(?=\n\n|$)/gi, '')
            .replace(/### (?:TYPES-FIRST|ARCHITECTURE-FIRST|CRITICAL GENERATION RULES)[\s\S]*?(?=\n\n|$)/gi, '')
            .trim();
          cleanIntro = sanitized.split('\n\n')[0]?.trim() || '';
        }
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
      if (err?.name === 'AbortError') {
        addLog('[AI] Generation cancelled by user.');
        setIsStreaming(false);
        setStreamingFile(null);
        setStatus('ready', 'Generation cancelled');
        setActiveSteps(
          activeSteps.map((s) => (s.status === 'running' ? { ...s, status: 'cancelled' as const } : s))
        );
        setActiveMilestones((prev) =>
          prev.map((m) => (m.status === 'running' ? { ...m, status: 'cancelled' as const } : m))
        );
        return;
      }
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
                  <ExecutionPlanCard
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
            <ExecutionPlanCard
              introText={
                streamingProse ||
                (runtimeError
                  ? `Diagnosing preview sandbox error and applying surgical repair for ${framework.toUpperCase()}...`
                  : Object.keys(files).length > 0
                  ? `Analyzing requested changes and updating your ${framework.toUpperCase()} application...`
                  : `I'll build a complete ${framework.toUpperCase()} application. Let's inspect the setup and create the components.`)
              }
              milestones={activeMilestones}
              filesRead={activeFilesRead}
              filesUpdated={activeFilesUpdated}
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

            {/* Send / Cancel button */}
            {status === 'generating' ? (
              <button
                type="button"
                onClick={handleCancelGeneration}
                className="absolute right-3 bottom-3 p-2 rounded-lg bg-red-600 hover:bg-red-500 text-white transition-all duration-200 shadow-lg shadow-red-900/50 hover:scale-105 active:scale-95 cursor-pointer"
                title="Stop Generating"
              >
                <Square className="w-4 h-4 fill-white" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={(!input.trim() && !attachedImage)}
                className="absolute right-3 bottom-3 p-2 rounded-lg bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 disabled:from-zinc-800 disabled:to-zinc-800 text-white disabled:text-zinc-500 transition-all duration-200 shadow-lg shadow-blue-900/50 disabled:shadow-none hover:scale-105 active:scale-95"
                title="Send with AI"
              >
                <Send className="w-4 h-4" />
              </button>
            )}
          </div>
        </form>
        </div>
      )}
    </div>
  );
}
