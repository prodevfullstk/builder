import { create } from 'zustand';

export type Framework = 'nextjs' | 'vite' | 'astro' | 'node';
export type BuilderMode = 'split' | 'code' | 'preview';
export type BuilderStatus = 'idle' | 'generating' | 'starting' | 'ready' | 'error';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface ProjectState {
  // Virtual Files
  files: Record<string, string>;
  activeFile: string;
  framework: Framework;
  
  // UI & Layout
  mode: BuilderMode;
  status: BuilderStatus;
  statusMessage: string;
  
  // Chat History
  messages: ChatMessage[];
  
  // Runtime Logs
  logs: string[];
  
  // Actions
  setFiles: (files: Record<string, string>) => void;
  updateFile: (path: string, content: string) => void;
  createFile: (path: string, content?: string) => void;
  deleteFile: (path: string) => void;
  setActiveFile: (path: string) => void;
  setFramework: (framework: Framework) => void;
  setMode: (mode: BuilderMode) => void;
  setStatus: (status: BuilderStatus, message?: string) => void;
  addMessage: (message: Omit<ChatMessage, 'id' | 'timestamp'>) => void;
  addLog: (log: string) => void;
  clearLogs: () => void;
  resetProject: () => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  files: {},
  activeFile: '',
  framework: 'nextjs',
  mode: 'split',
  status: 'idle',
  statusMessage: '',
  messages: [
    {
      id: 'init-1',
      role: 'assistant',
      content: 'Hello! I am Opendork. Describe any website, web app, or feature you would like to build.',
      timestamp: Date.now(),
    },
  ],
  logs: ['[System] Workspace ready.'],

  setFiles: (files) => set({ files }),

  updateFile: (path, content) =>
    set((state) => ({
      files: {
        ...state.files,
        [path]: content,
      },
    })),

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

  setMode: (mode) => set({ mode }),

  setStatus: (status, statusMessage = '') => set({ status, statusMessage }),

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

  addLog: (log) =>
    set((state) => ({
      logs: [...state.logs.slice(-200), log], // keep last 200 logs
    })),

  clearLogs: () => set({ logs: [] }),

  resetProject: () =>
    set({
      files: {},
      activeFile: '',
      framework: 'nextjs',
      status: 'idle',
      statusMessage: '',
      logs: ['[System] Workspace reset.'],
    }),
}));
