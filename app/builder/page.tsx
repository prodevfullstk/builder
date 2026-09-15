"use client";

// Force dynamic rendering — builder uses browser-only APIs (cuid, Nodebox, esbuild-wasm)
export const dynamic = "force-dynamic";

import React, { useEffect, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useProjectStore, Framework } from "@/lib/store/project-store";
import { BuilderHeader } from "@/components/builder/builder-header";
import { ChatPanel } from "@/components/builder/chat-panel";
import { FileTree } from "@/components/builder/file-tree";
import { CodeEditor } from "@/components/builder/code-editor";
import { PreviewPane } from "@/components/builder/preview-pane";
import {
  loadProjectFromStorage,
  saveProjectToStorage,
  createNewProjectObject,
  SavedProject,
} from "@/lib/storage/project-storage";
import { parseFinalOutput } from "@/lib/ai/code-parser";
import { parseToolCalls, executeToolCalls } from "@/lib/ai/mcp-executor";
import { useCreditsStore } from "@/lib/store/credits-store";
import { evaluateCandidateChanges } from "@/lib/validation/candidate-pipeline";
import { synthesizeProjectRequirements } from "@/lib/ai/requirements-generator";
import { AuthModal } from "@/components/auth/auth-modal";
import { useAuthStore, getClientAuthHeaders } from "@/lib/auth/supabase-auth";

function BuilderWorkspace() {
  const {
    projectId,
    projectName,
    setProjectId,
    setProjectName,
    loadProjectState,
    setIsSaved,
    mode,
    status,
    setStatus,
    addMessage,
    files,
    setFiles,
    framework,
    dbProvider,
    authProvider,
    messages,
    activeFile,
    addLog,
    setActiveFile,
    setStreamingFile,
    setIsStreaming,
    setActiveSteps,
    setProjectSpec,
  } = useProjectStore();

  const searchParams = useSearchParams();
  const hasInitialized = useRef(false);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 1. Initial Project Loading & URL Sync
  useEffect(() => {
    if (hasInitialized.current) return;
    hasInitialized.current = true;

    const urlId = searchParams.get("id");
    const initialPrompt = searchParams.get("prompt");
    const urlFramework = (searchParams.get("framework") as any) || undefined;
    const urlDb = (searchParams.get("db") as any) || undefined;

    if (urlId) {
      // Load existing project by ID from storage
      const existing = loadProjectFromStorage(urlId);
      if (existing) {
        loadProjectState(existing);
        addLog(`[Project] Loaded "${existing.name}" (${urlId})`);
        return;
      }
    }

    // No valid ID in URL — create new project
    const defaultName = initialPrompt
      ? initialPrompt.slice(0, 32)
      : "Untitled Project";

    // Auto-detect best framework & database intelligently from user's prompt
    let detectedFramework: Framework = 'vite'; // Default fast & reliable instant preview stack
    let detectedDb = 'none';

    if (initialPrompt) {
      if (/\b(nextjs|next\.js|next\s+15|next\s+14|ssr|server\s+action)\b/i.test(initialPrompt)) {
        detectedFramework = 'nextjs';
      } else if (/\b(astro)\b/i.test(initialPrompt)) {
        detectedFramework = 'astro';
      } else if (/\b(express|fastify|backend\s+only|node\.js\s+api)\b/i.test(initialPrompt)) {
        detectedFramework = 'node';
      }

      if (/\b(supabase|sql|database|db|postgres|table|store\s+data)\b/i.test(initialPrompt)) {
        detectedDb = 'supabase';
      }
    }

    const targetFramework = urlFramework || detectedFramework;
    const newProj = createNewProjectObject(defaultName, targetFramework);
    newProj.dbProvider = (urlDb || detectedDb) as any;
    loadProjectState(newProj);

    // Update browser URL without reloading page
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `/builder?id=${newProj.id}`);
    }
    addLog(`[Project] Created new workspace (${newProj.id})`);

    // If navigated with ?prompt=..., trigger AI generation immediately
    if (initialPrompt && status === "idle") {
      const runInitialGeneration = async () => {
        // Enforce authentic Supabase session before starting project build
        const authState = useAuthStore.getState();
        if (!authState.isAuthenticated || !authState.accessToken) {
          addMessage({
            role: "assistant",
            content: "🔒 Please sign in with your account to start generating and developing this project.",
          });
          authState.setAuthModalOpen(true);
          setStatus("idle");
          return;
        }

        // Deduct points for new build
        const hasCredits = useCreditsStore.getState().deductCredits('NEW_PROJECT_BUILD');
        if (!hasCredits) {
          addMessage({
            role: "assistant",
            content: "⚠️ You have run out of AI credits. Please click your credits balance in the header to claim your free daily points or top up!",
          });
          setStatus("idle");
          return;
        }

        // Check for cached reference image transferred from home page
        let initialImage: string | undefined = undefined;
        if (typeof window !== "undefined") {
          try {
            const cached = sessionStorage.getItem("opendork_init_image");
            if (cached) {
              initialImage = cached;
              sessionStorage.removeItem("opendork_init_image");
            }
          } catch (err) {
            console.warn("Could not read cached init image:", err);
          }
        }

        addMessage({ role: "user", content: initialPrompt, image: initialImage });
        setStatus("generating", `Building ${targetFramework.toUpperCase()} project...`);
        setIsStreaming(true);

        const analyzeStep = {
          id: "init-analyze",
          type: "thought" as const,
          label: initialImage
            ? `Analyzing screenshot & visual mockup for ${targetFramework.toUpperCase()}...`
            : `Analyzing request for ${targetFramework.toUpperCase()}...`,
          status: "running" as const,
        };
        setActiveSteps([analyzeStep]);

        try {
          const response = await fetch("/api/agent", {
            method: "POST",
            headers: getClientAuthHeaders(),
            body: JSON.stringify({
              message: initialPrompt,
              image: initialImage,
              framework: targetFramework,
              dbProvider: urlDb || newProj.dbProvider,
              authProvider,
              history: [],
              files: {},
              mode: "build",
            }),
          });

          if (!response.ok || !response.body) {
            throw new Error(`HTTP ${response.status}`);
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let accumulated = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            accumulated += decoder.decode(value, { stream: true });
          }

          // Execute MCP tool calls if emitted
          const { toolCalls, explanation: mcpExplanation } = parseToolCalls(accumulated);
          let genFiles: Record<string, string> = {};

          if (toolCalls.length > 0) {
            const res = executeToolCalls({}, toolCalls);
            genFiles = res.updatedFiles;
          }

          // Fallback to standard parser
          const { files: parsedFiles, aiExplanation } = parseFinalOutput(accumulated);
          const candidateFiles = { ...parsedFiles, ...genFiles };

          // Synthesize structured requirements specification (P1-D requirement)
          const { spec, requirementsMarkdown } = synthesizeProjectRequirements(
            initialPrompt,
            targetFramework,
            (urlDb || newProj.dbProvider) as string,
            authProvider
          );
          setProjectSpec(spec);
          newProj.spec = spec;
          candidateFiles['requirements.md'] = requirementsMarkdown;

          // Validate candidate against framework contract
          addLog(`[Candidate Pipeline] Validating initial ${targetFramework.toUpperCase()} build...`);
          const evalResult = await evaluateCandidateChanges({
            projectId: newProj.id,
            framework: targetFramework,
            currentFiles: {},
            candidateFiles,
            isNewBuild: true,
          });

          if (!evalResult.accepted) {
            addLog(`[Candidate Pipeline] ✕ Initial generation rejected: ${evalResult.diagnostics.join(' | ')}`);
            setIsStreaming(false);
            setStreamingFile(null);
            setStatus("error", "Initial candidate failed framework validation");
            addMessage({
              role: "assistant",
              content: `⚠️ Generation failed framework contract validation: ${evalResult.diagnostics.join('; ')}`,
            });
            return;
          }

          const finalFiles = evalResult.committedFiles;
          setFiles(finalFiles);
          addLog(`[Candidate Pipeline] ✓ Initial build accepted (${evalResult.evidence.checks.length} checks passed).`);
          const entry =
            finalFiles["app/page.tsx"]
              ? "app/page.tsx"
              : finalFiles["src/App.tsx"]
              ? "src/App.tsx"
              : Object.keys(finalFiles)[0];
          if (entry) setActiveFile(entry);

          const steps = [
            { id: "init-analyze", type: "thought" as const, label: "Analyzed requirements", status: "completed" as const },
            { id: "init-build", type: "file" as const, label: `Built and validated ${Object.keys(finalFiles).length} project files`, status: "completed" as const },
            { id: "init-preview", type: "preview" as const, label: "Preview ready", status: "completed" as const },
          ];

          setActiveSteps(steps);
          setIsStreaming(false);
          setStreamingFile(null);

          const explanation = mcpExplanation || aiExplanation || `Generated ${framework.toUpperCase()} application.`;
          addMessage({
            role: "assistant",
            content: explanation,
            steps,
            filesGenerated: Object.keys(finalFiles),
            showPreview: true,
          });

          setStatus("ready", "Application ready");
        } catch (err: any) {
          setIsStreaming(false);
          setStreamingFile(null);
          setStatus("error", err?.message || "Generation failed");
          addMessage({
            role: "assistant",
            content: `⚠️ Generation error: ${err?.message || "Please check connection"}.`,
          });
        }
      };

      runInitialGeneration();
    }
  }, [searchParams]);

  // 2. Debounced Auto-Save to Persistent Storage
  useEffect(() => {
    if (!projectId || !hasInitialized.current) return;

    // Mark as unsaved immediately
    setIsSaved(false);

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(() => {
      const projectData: SavedProject = {
        id: projectId,
        name: projectName || "Untitled Project",
        framework,
        dbProvider,
        authProvider,
        files,
        messages,
        activeFile,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      saveProjectToStorage(projectData);
      setIsSaved(true);
    }, 600);

    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [projectId, projectName, files, messages, framework, dbProvider, authProvider, activeFile]);

  return (
    <div className="h-screen w-screen flex flex-col bg-zinc-950 overflow-hidden text-zinc-100">
      {/* Auth Modal for Sign In */}
      <AuthModal />

      {/* Top Header with Persistence & Projects Switcher */}
      <BuilderHeader />

      {/* Main Workspace Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Chat Panel */}
        <ChatPanel />

        {/* Center / Right Dynamic Workspace */}
        <div className="flex-1 flex overflow-hidden">
          {mode === "split" && (
            <>
              <FileTree />
              <CodeEditor />
              <PreviewPane />
            </>
          )}

          {mode === "code" && (
            <>
              <FileTree />
              <CodeEditor />
            </>
          )}

          {mode === "preview" && <PreviewPane />}
        </div>
      </div>
    </div>
  );
}

export default function BuilderPage() {
  return (
    <Suspense
      fallback={
        <div className="h-screen w-screen bg-zinc-950 flex items-center justify-center text-zinc-400 text-sm">
          Loading Workspace...
        </div>
      }
    >
      <BuilderWorkspace />
    </Suspense>
  );
}
