"use client";

import React, { useState, useEffect } from "react";
import {
  FolderKanban,
  Plus,
  Trash2,
  ExternalLink,
  Clock,
  FileCode,
  X,
  Sparkles,
} from "lucide-react";
import {
  listSavedProjects,
  deleteProjectFromStorage,
  createNewProjectObject,
  SavedProjectSummary,
} from "@/lib/storage/project-storage";
import { useProjectStore, Framework } from "@/lib/store/project-store";

interface ProjectsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectProject: (id: string) => void;
  onNewProject: (framework?: Framework) => void;
}

export function ProjectsModal({
  isOpen,
  onClose,
  onSelectProject,
  onNewProject,
}: ProjectsModalProps) {
  const { projectId: currentId } = useProjectStore();
  const [projects, setProjects] = useState<SavedProjectSummary[]>([]);
  const [newFramework, setNewFramework] = useState<Framework>("nextjs");

  const refreshList = () => {
    setProjects(listSavedProjects());
  };

  useEffect(() => {
    if (isOpen) {
      refreshList();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm("Are you sure you want to delete this project? This cannot be undone.")) {
      deleteProjectFromStorage(id);
      refreshList();
    }
  };

  const formatTime = (ms: number) => {
    const diff = Date.now() - ms;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
      <div className="w-full max-w-xl bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/60">
          <div className="flex items-center gap-2.5">
            <FolderKanban className="w-5 h-5 text-blue-400" />
            <h2 className="font-semibold text-zinc-100 text-sm">My Projects</h2>
            <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 font-mono">
              {projects.length}
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-200 p-1 rounded-md transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* New Project Quick Bar */}
        <div className="px-5 py-3 border-b border-zinc-800/80 bg-zinc-900/30 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-400">Framework:</span>
            <select
              value={newFramework}
              onChange={(e) => setNewFramework(e.target.value as Framework)}
              className="bg-zinc-900 border border-zinc-700 text-xs text-zinc-200 rounded px-2 py-1 focus:outline-none"
            >
              <option value="nextjs">Next.js 15</option>
              <option value="vite">Vite + React</option>
              <option value="astro">Astro</option>
              <option value="nodejs">Node.js API</option>
            </select>
          </div>
          <button
            onClick={() => {
              onNewProject(newFramework);
              onClose();
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-lg transition-colors shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Project</span>
          </button>
        </div>

        {/* Projects List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {projects.length === 0 ? (
            <div className="text-center py-12 text-zinc-500 text-xs">
              <FileCode className="w-8 h-8 mx-auto mb-2 text-zinc-600" />
              No saved projects yet. Click &quot;New Project&quot; to create one!
            </div>
          ) : (
            projects.map((proj) => {
              const isCurrent = proj.id === currentId;
              return (
                <div
                  key={proj.id}
                  onClick={() => {
                    onSelectProject(proj.id);
                    onClose();
                  }}
                  className={`flex items-center justify-between p-3 rounded-lg border transition-all cursor-pointer ${
                    isCurrent
                      ? "bg-blue-500/10 border-blue-500/30 hover:bg-blue-500/15"
                      : "bg-zinc-900/40 border-zinc-800/80 hover:bg-zinc-800/50 hover:border-zinc-700"
                  }`}
                >
                  <div className="min-w-0 flex-1 pr-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-sm text-zinc-200 truncate">
                        {proj.name}
                      </span>
                      {isCurrent && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 font-medium">
                          Active
                        </span>
                      )}
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 uppercase font-mono">
                        {proj.framework}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-zinc-500">
                      <span className="flex items-center gap-1">
                        <FileCode className="w-3 h-3" />
                        {proj.fileCount} {proj.fileCount === 1 ? "file" : "files"}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatTime(proj.updatedAt)}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={(e) => handleDelete(e, proj.id)}
                      className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                      title="Delete project"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
