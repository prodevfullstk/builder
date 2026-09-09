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

const DEFAULT_NEXTJS_FILES: Record<string, string> = {
  'package.json': JSON.stringify(
    {
      name: 'opendork-app',
      version: '0.1.0',
      private: true,
      scripts: {
        dev: 'next dev --port 3000 --hostname 0.0.0.0',
        build: 'next build',
        start: 'next start',
      },
      dependencies: {
        next: '^14.2.0',
        react: '^18.3.0',
        'react-dom': '^18.3.0',
        'lucide-react': '^0.454.0',
        clsx: '^2.1.1',
        'tailwind-merge': '^2.5.0',
      },
    },
    null,
    2
  ),
  'app/layout.tsx': `export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body style={{ margin: 0, padding: 0, backgroundColor: '#09090b', color: '#f4f4f5', fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
        {children}
      </body>
    </html>
  );
}`,
  'app/page.tsx': `'use client';

import React, { useState } from 'react';

export default function Home() {
  const [count, setCount] = useState(0);

  return (
    <main style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem', textAlign: 'center' }}>
      <div style={{ maxWidth: '600px', backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '16px', padding: '2.5rem', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)' }}>
        <div style={{ display: 'inline-block', padding: '6px 14px', borderRadius: '9999px', backgroundColor: '#2563eb20', color: '#60a5fa', fontSize: '13px', fontWeight: 600, marginBottom: '1.5rem', border: '1px solid #2563eb40' }}>
          ⚡ Opendork Live Preview
        </div>
        
        <h1 style={{ fontSize: '2.25rem', fontWeight: 800, margin: '0 0 1rem 0', background: 'linear-gradient(to right, #60a5fa, #a855f7)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          Ready to Build
        </h1>
        
        <p style={{ color: '#a1a1aa', fontSize: '15px', lineHeight: 1.6, margin: '0 0 2rem 0' }}>
          Describe what you want to build in the prompt panel on the left, or customize the code in the editor!
        </p>

        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', alignItems: 'center' }}>
          <button
            onClick={() => setCount((prev) => prev + 1)}
            style={{ padding: '10px 20px', borderRadius: '8px', backgroundColor: '#2563eb', color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s' }}
          >
            Interactive Button: {count}
          </button>
        </div>
      </div>
    </main>
  );
}`,
};

export const useProjectStore = create<ProjectState>((set) => ({
  files: DEFAULT_NEXTJS_FILES,
  activeFile: 'app/page.tsx',
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
  logs: ['[System] Workspace initialized. Ready to generate.'],

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
      files: DEFAULT_NEXTJS_FILES,
      activeFile: 'app/page.tsx',
      framework: 'nextjs',
      status: 'idle',
      statusMessage: '',
      logs: ['[System] Workspace reset to default starter template.'],
    }),
}));
