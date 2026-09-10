'use client';

import React, { useState, useMemo } from 'react';
import {
  FileCode,
  FileJson,
  FileText,
  FilePlus,
  Trash2,
  FolderTree,
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
} from 'lucide-react';
import { useProjectStore } from '@/lib/store/project-store';

// VS Code-style sidebar panel toggle icon (same as chat panel)
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
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <rect x="1.5" y="2.5" width="4" height="11" rx="1.5" fill="currentColor" opacity="0.9" />
      <line x1="5.5" y1="2.5" x2="5.5" y2="13.5" stroke="currentColor" strokeWidth="1.2" opacity="0.5" />
    </svg>
  );
}

interface TreeNode {
  name: string;
  path: string;
  isFolder: boolean;
  children: Record<string, TreeNode>;
}

export function FileTree() {
  const {
    files,
    activeFile,
    setActiveFile,
    createFile,
    deleteFile,
    streamingFile,
    isStreaming,
  } = useProjectStore();
  const [isMinimized, setIsMinimized] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newFilePath, setNewFilePath] = useState('');
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});

  const toggleFolder = (folderPath: string) => {
    setCollapsedFolders((prev) => ({
      ...prev,
      [folderPath]: !prev[folderPath],
    }));
  };

  // Build hierarchical folder tree structure
  const tree = useMemo(() => {
    const root: Record<string, TreeNode> = {};

    for (const filePath of Object.keys(files)) {
      const parts = filePath.split('/');
      let currentLevel = root;
      let currentPath = '';

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        const isLast = i === parts.length - 1;

        if (isLast) {
          currentLevel[part] = {
            name: part,
            path: currentPath,
            isFolder: false,
            children: {},
          };
        } else {
          if (!currentLevel[part]) {
            currentLevel[part] = {
              name: part,
              path: currentPath,
              isFolder: true,
              children: {},
            };
          }
          currentLevel = currentLevel[part].children;
        }
      }
    }

    return root;
  }, [files]);

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newFilePath.trim()) {
      createFile(newFilePath.trim(), '// New file\n');
      setNewFilePath('');
      setIsCreating(false);
    }
  };

  const getFileIcon = (path: string) => {
    if (path.endsWith('.tsx') || path.endsWith('.jsx')) {
      return <FileCode className="w-3.5 h-3.5 text-sky-400 shrink-0" />;
    }
    if (path.endsWith('.ts') || path.endsWith('.js') || path.endsWith('.mjs')) {
      return <FileCode className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
    }
    if (path.endsWith('.json')) {
      return <FileJson className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
    }
    if (path.endsWith('.css')) {
      return <FileText className="w-3.5 h-3.5 text-indigo-400 shrink-0" />;
    }
    return <FileText className="w-3.5 h-3.5 text-zinc-400 shrink-0" />;
  };

  const renderTree = (nodes: Record<string, TreeNode>, depth: number = 0) => {
    const entries = Object.values(nodes).sort((a, b) => {
      // Folders first, then files
      if (a.isFolder && !b.isFolder) return -1;
      if (!a.isFolder && b.isFolder) return 1;
      return a.name.localeCompare(b.name);
    });

    return entries.map((node) => {
      const isCollapsed = !!collapsedFolders[node.path];
      const indentClass = depth === 1 ? 'pl-5' : depth === 2 ? 'pl-8' : depth > 2 ? 'pl-11' : 'pl-3';

      if (node.isFolder) {
        const childCount = Object.keys(node.children).length;
        return (
          <div key={node.path} className="flex flex-col">
            <button
              onClick={() => toggleFolder(node.path)}
              className={`flex items-center gap-1.5 py-1.5 pr-3 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60 transition-colors w-full text-left select-none text-[11px] font-medium ${indentClass}`}
            >
              {isCollapsed ? (
                <ChevronRight className="w-3 h-3 text-zinc-500 shrink-0" />
              ) : (
                <ChevronDown className="w-3 h-3 text-zinc-500 shrink-0" />
              )}
              {isCollapsed ? (
                <Folder className="w-3.5 h-3.5 text-amber-400/80 shrink-0" />
              ) : (
                <FolderOpen className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              )}
              <span className="truncate">{node.name}</span>
              <span className="ml-auto text-[10px] text-zinc-600">({childCount})</span>
            </button>

            {!isCollapsed && renderTree(node.children, depth + 1)}
          </div>
        );
      }

      const isActive = activeFile === node.path;
      const isWriting = isStreaming && streamingFile === node.path;

      return (
        <div
          key={node.path}
          onClick={() => setActiveFile(node.path)}
          className={`group flex items-center justify-between py-1.5 pr-2.5 cursor-pointer transition-colors text-[11px] ${indentClass} ${
            isActive
              ? 'bg-blue-600/15 text-blue-400 font-medium border-l-2 border-blue-500'
              : 'text-zinc-400 hover:bg-zinc-900/60 hover:text-zinc-200 border-l-2 border-transparent'
          }`}
        >
          <div className="flex items-center gap-1.5 truncate">
            {getFileIcon(node.path)}
            <span className="truncate">{node.name}</span>
            {isWriting && (
              <span className="flex items-center gap-1 ml-1 text-[9px] text-blue-400 font-sans font-normal px-1 py-0.2 rounded bg-blue-500/15 border border-blue-500/30 animate-pulse">
                <span className="w-1 h-1 rounded-full bg-blue-400 animate-ping" />
                <span>typing...</span>
              </span>
            )}
          </div>

          <button
            onClick={(e) => {
              e.stopPropagation();
              deleteFile(node.path);
            }}
            className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-red-400 text-zinc-600 transition-opacity"
            title="Delete file"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      );
    });
  };

  const totalFiles = Object.keys(files).length;

  return (
    <div className={`${isMinimized ? 'w-12' : 'w-60'} h-full border-r border-zinc-800 bg-zinc-950 flex flex-col select-none text-xs shrink-0 transition-all duration-300`}>
      {/* Explorer Header */}
      <div className="h-9 px-3 border-b border-zinc-800 flex items-center justify-between text-zinc-400 font-semibold uppercase tracking-wider text-[10px]">
        <div className="flex items-center gap-1.5">
          {!isMinimized && (
            <>
              <FolderTree className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
              <span>Explorer</span>
              {totalFiles > 0 && (
                <span className="px-1.5 py-0.2 rounded bg-zinc-900 border border-zinc-800 text-[10px] text-zinc-500 font-normal">
                  {totalFiles}
                </span>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-1">
          {!isMinimized && (
            <button
              onClick={() => setIsCreating(true)}
              className="p-1 hover:bg-zinc-800 hover:text-zinc-200 rounded text-zinc-400 transition-colors"
              title="New File"
            >
              <FilePlus className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={() => setIsMinimized(!isMinimized)}
            className="p-1.5 hover:bg-zinc-800 rounded-md transition-colors text-zinc-500 hover:text-zinc-300"
            title={isMinimized ? 'Expand explorer' : 'Collapse explorer'}
          >
            <PanelToggleIcon mirrored={isMinimized} />
          </button>
        </div>
      </div>

      {/* Inline Create Input */}
      {!isMinimized && isCreating && (
        <form onSubmit={handleCreateSubmit} className="p-2 border-b border-zinc-800 bg-zinc-900/50">
          <input
            type="text"
            placeholder="e.g. components/Hero.tsx"
            value={newFilePath}
            onChange={(e) => setNewFilePath(e.target.value)}
            onBlur={() => {
              if (!newFilePath.trim()) setIsCreating(false);
            }}
            autoFocus
            className="w-full px-2 py-1 bg-zinc-900 border border-blue-500 rounded text-xs text-zinc-200 focus:outline-none"
          />
        </form>
      )}

      {/* Hierarchical Folder Tree */}
      {!isMinimized && (
        <div className="flex-1 overflow-y-auto py-1">
          {totalFiles === 0 ? (
            <div className="p-4 text-center text-zinc-600 text-xs italic">
              No files generated yet.
            </div>
          ) : (
            renderTree(tree)
          )}
        </div>
      )}
    </div>
  );
}
