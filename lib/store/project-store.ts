import { create } from 'zustand';
import { ProjectSpec } from '@/lib/validation/types';

export type Framework = 'nextjs' | 'vite' | 'astro' | 'node';
export type BuilderMode = 'split' | 'code' | 'preview';
export type BuilderStatus = 'idle' | 'generating' | 'starting' | 'ready' | 'error';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  image?: string; // Base64 data URL of user uploaded screenshot or UI mockup
  timestamp: number;
  steps?: TimelineStep[];
  filesGenerated?: string[];
  showPreview?: boolean;
  screenshot?: string;
}

export interface TimelineStep {
  id: string;
  type: 'thought' | 'inspect' | 'design' | 'file' | 'preview';
  label: string;
  detail?: string;
  status: 'pending' | 'running' | 'completed';
  file?: string;
  linesAdded?: number;
  duration?: string;
}

export interface ProjectState {
  // Virtual Files
  files: Record<string, string>;
  activeFile: string;
  streamingFile: string | null;
  isStreaming: boolean;
  framework: Framework;
  frameworkVersion: string;
  projectSpec: ProjectSpec | null;
  
  // Project Identity & Persistence
  projectId: string | null;
  projectName: string;
  isSaved: boolean;
  lastSavedAt: number | null;

  // UI & Layout
  mode: BuilderMode;
  status: BuilderStatus;
  statusMessage: string;

  // Tech stack selection
  dbProvider: 'none' | 'supabase' | 'mysql' | 'postgres' | 'sqlite' | 'prisma' | 'drizzle';
  authProvider: 'none' | 'supabase' | 'nextauth' | 'clerk';
  
  // Cross-component signals
  createFileRequest: number; // incremented to signal FileTree to open create input
  
  // Chat History & Timeline Steps
  messages: ChatMessage[];
  activeSteps: TimelineStep[];
  
  // Runtime Error & Auto-Fix
  runtimeError: string | null;
  autoFixAttempts: number;

  // Runtime Logs
  logs: string[];
  
  // Actions
  setFiles: (files: Record<string, string>) => void;
  updateFile: (path: string, content: string) => void;
  editFile: (path: string, targetContent: string, replacementContent: string) => boolean;
  createFile: (path: string, content?: string) => void;
  deleteFile: (path: string) => void;
  setActiveFile: (path: string) => void;
  setStreamingFile: (file: string | null) => void;
  setIsStreaming: (isStreaming: boolean) => void;
  setActiveSteps: (steps: TimelineStep[]) => void;
  addStep: (step: TimelineStep) => void;
  updateStep: (id: string, updates: Partial<TimelineStep>) => void;
  setFramework: (framework: Framework) => void;
  setFrameworkVersion: (frameworkVersion: string) => void;
  setProjectSpec: (projectSpec: ProjectSpec | null) => void;
  setMode: (mode: BuilderMode) => void;
  setStatus: (status: BuilderStatus, message?: string) => void;
  setDbProvider: (db: ProjectState['dbProvider']) => void;
  setAuthProvider: (auth: ProjectState['authProvider']) => void;
  setRuntimeError: (err: string | null) => void;
  clearRuntimeError: () => void;
  incrementAutoFixAttempts: () => void;
  resetAutoFixAttempts: () => void;
  addMessage: (message: Omit<ChatMessage, 'id' | 'timestamp'>) => void;
  updateStreamingMessage: (content: string) => void;
  updateLastMessageScreenshot: (screenshot: string) => void;
  requestCreateFile: () => void;
  addLog: (log: string) => void;
  clearLogs: () => void;
  resetProject: () => void;
  setProjectId: (id: string) => void;
  setProjectName: (name: string) => void;
  setIsSaved: (isSaved: boolean) => void;
  loadProjectState: (project: {
    id: string;
    name: string;
    framework?: Framework;
    dbProvider?: ProjectState['dbProvider'];
    authProvider?: ProjectState['authProvider'];
    files: Record<string, string>;
    messages: ChatMessage[];
    activeFile?: string;
  }) => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  projectId: null,
  projectName: 'Untitled Project',
  isSaved: true,
  lastSavedAt: null,
  files: {},
  activeFile: '',
  streamingFile: null,
  isStreaming: false,
  framework: 'nextjs',
  frameworkVersion: '15.1.7',
  projectSpec: null,
  mode: 'split',
  status: 'idle',
  statusMessage: '',
  dbProvider: 'none',
  authProvider: 'none',
  runtimeError: null,
  autoFixAttempts: 0,
  createFileRequest: 0,
  messages: [
    {
      id: 'init-1',
      role: 'assistant',
      content: 'Hello! I am Opendork. Describe any website, web app, or feature you would like to build.',
      timestamp: Date.now(),
    },
  ],
  activeSteps: [],
  logs: ['[System] Workspace ready.'],

  setFiles: (files) => set({ files }),
  setStreamingFile: (streamingFile) => set({ streamingFile }),
  setIsStreaming: (isStreaming) => set({ isStreaming }),
  setActiveSteps: (activeSteps) => set({ activeSteps }),

  addStep: (step) =>
    set((state) => ({
      activeSteps: [...state.activeSteps, step],
    })),

  updateStep: (id, updates) =>
    set((state) => ({
      activeSteps: state.activeSteps.map((s) =>
        s.id === id ? { ...s, ...updates } : s
      ),
    })),

  updateFile: (path, content) =>
    set((state) => ({
      files: {
        ...state.files,
        [path]: content,
      },
    })),

  editFile: (path, targetContent, replacementContent) => {
    let success = false;
    set((state) => {
      const current = state.files[path];
      if (!current) return state;

      if (current.includes(targetContent)) {
        success = true;
        return {
          files: {
            ...state.files,
            [path]: current.replace(targetContent, replacementContent),
          },
          activeFile: path,
        };
      }

      // Fallback: trimmed match
      const trimmedTarget = targetContent.trim();
      if (trimmedTarget && current.includes(trimmedTarget)) {
        success = true;
        return {
          files: {
            ...state.files,
            [path]: current.replace(trimmedTarget, replacementContent.trim()),
          },
          activeFile: path,
        };
      }

      return state;
    });
    return success;
  },

  createFile: (path, content = '') =>
    set((state) => ({
      files: {
        ...state.files,
        [path]: content,
      },
      activeFile: path,
    })),

  deleteFile: (path) =>
    set((state) => {
      const newFiles = { ...state.files };
      delete newFiles[path];
      const remainingPaths = Object.keys(newFiles);
      const nextActive =
        state.activeFile === path
          ? remainingPaths[0] || ''
          : state.activeFile;
      return { files: newFiles, activeFile: nextActive };
    }),

  setActiveFile: (activeFile) => set({ activeFile }),

  setFramework: (framework) => set({ framework }),
  setFrameworkVersion: (frameworkVersion) => set({ frameworkVersion }),
  setProjectSpec: (projectSpec) => set({ projectSpec }),

  setMode: (mode) => set({ mode }),

  setStatus: (status, statusMessage = '') => set({ status, statusMessage }),

  setDbProvider: (dbProvider) => set({ dbProvider }),

  setAuthProvider: (authProvider) => set({ authProvider }),

  setRuntimeError: (runtimeError) => set({ runtimeError }),

  clearRuntimeError: () => set({ runtimeError: null }),

  incrementAutoFixAttempts: () =>
    set((state) => ({ autoFixAttempts: state.autoFixAttempts + 1 })),

  resetAutoFixAttempts: () => set({ autoFixAttempts: 0 }),

  addMessage: (message) =>
    set((state) => ({
      messages: [
        ...state.messages,
        {
          ...message,
          id: Math.random().toString(36).substring(2, 9),
          timestamp: Date.now(),
        },
      ],
    })),

  updateStreamingMessage: (content) =>
    set((state) => {
      const msgs = [...state.messages];
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === 'assistant') {
          msgs[i] = { ...msgs[i], content };
          break;
        }
      }
      return { messages: msgs };
    }),

  updateLastMessageScreenshot: (screenshot) =>
    set((state) => {
      const msgs = [...state.messages];
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === 'assistant') {
          msgs[i] = { ...msgs[i], screenshot };
          break;
        }
      }
      return { messages: msgs };
    }),

  requestCreateFile: () =>
    set((state) => ({ createFileRequest: state.createFileRequest + 1 })),

  addLog: (log) =>
    set((state) => ({
      logs: [...state.logs.slice(-200), log], // keep last 200 logs
    })),

  clearLogs: () => set({ logs: [] }),

  resetProject: () =>
    set({
      files: {},
      activeFile: '',
      streamingFile: null,
      isStreaming: false,
      activeSteps: [],
      framework: 'nextjs',
      status: 'idle',
      statusMessage: '',
      runtimeError: null,
      autoFixAttempts: 0,
      logs: ['[System] Workspace reset.'],
    }),

  setProjectId: (projectId) => set({ projectId }),

  setProjectName: (projectName) => set({ projectName, isSaved: false }),

  setIsSaved: (isSaved) =>
    set({ isSaved, ...(isSaved ? { lastSavedAt: Date.now() } : {}) }),

  loadProjectState: (project) =>
    set({
      projectId: project.id,
      projectName: project.name || 'Untitled Project',
      framework: project.framework || 'nextjs',
      dbProvider: project.dbProvider || 'none',
      authProvider: project.authProvider || 'none',
      files: project.files || {},
      messages: project.messages || [],
      activeFile: project.activeFile || Object.keys(project.files || {})[0] || '',
      isSaved: true,
      lastSavedAt: Date.now(),
      runtimeError: null,
      autoFixAttempts: 0,
      activeSteps: [],
      status: 'ready',
      statusMessage: 'Project loaded',
    }),
}));
