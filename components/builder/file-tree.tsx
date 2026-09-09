'use client';

import React, { useState } from 'react';
import {
  FileCode,
  FileJson,
  FileText,
  FilePlus,
  Trash2,
  FolderTree,
} from 'lucide-react';
import { useProjectStore } from '@/lib/store/project-store';

export function FileTree() {
  const { files, activeFile, setActiveFile, createFile, deleteFile } = useProjectStore();
  const [isCreating, setIsCreating] = useState(false);
  const [newFilePath, setNewFilePath] = useState('');

  const sortedPaths = Object.keys(files).sort((a, b) => {
    // Put root files last, folders first
    const aIsRoot = !a.includes('/');
    const bIsRoot = !b.includes('/');
    if (aIsRoot && !bIsRoot) return 1;
    if (!aIsRoot && bIsRoot) return -1;
    return a.localeCompare(b);
  });

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

  return (
    <div className="w-56 h-full border-r border-zinc-800 bg-zinc-950 flex flex-col select-none text-xs shrink-0">
      {/* Explorer Header */}
      <div className="h-9 px-3 border-b border-zinc-800 flex items-center justify-between text-zinc-400 font-semibold uppercase tracking-wider text-[10px]">
        <div className="flex items-center gap-1.5">
          <FolderTree className="w-3.5 h-3.5 text-zinc-400" />
          <span>Explorer</span>
        </div>
        <button
          onClick={() => setIsCreating(true)}
          className="p-1 hover:bg-zinc-800 hover:text-zinc-200 rounded text-zinc-400 transition-colors"
          title="New File"
        >
          <FilePlus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Inline Create Input */}
      {isCreating && (
        <form onSubmit={handleCreateSubmit} className="p-2 border-b border-zinc-800 bg-zinc-900/50">
          <input
            type="text"
            placeholder="e.g. components/Button.tsx"
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

      {/* File List */}
      <div className="flex-1 overflow-y-auto py-1">
        {sortedPaths.length === 0 ? (
          <div className="p-4 text-center text-zinc-600 text-xs italic">
            No files generated yet.
          </div>
        ) : (
          sortedPaths.map((path) => {
            const isActive = activeFile === path;
            return (
              <div
                key={path}
                onClick={() => setActiveFile(path)}
                className={`group flex items-center justify-between px-3 py-1.5 cursor-pointer transition-colors ${
                  isActive
                    ? 'bg-zinc-800/80 text-blue-400 font-medium'
                    : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
                }`}
              >
                <div className="flex items-center gap-2 truncate min-w-0">
                  {getFileIcon(path)}
                  <span className="truncate">{path}</span>
                </div>

                {sortedPaths.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Delete ${path}?`)) {
                        deleteFile(path);
                      }
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-zinc-800 hover:text-red-400 rounded text-zinc-500 transition-all"
                    title="Delete File"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Footer info */}
      <div className="px-3 py-2 border-t border-zinc-900 text-[10px] text-zinc-500 flex justify-between items-center">
        <span>{sortedPaths.length} files</span>
      </div>
    </div>
  );
}
