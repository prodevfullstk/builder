'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  Sparkles,
  Download,
  RotateCcw,
  Code2,
  Eye,
  Columns,
  Layers,
  ChevronDown,
  FolderKanban,
  Check,
  Edit2,
  Github,
} from 'lucide-react';
import { useProjectStore, Framework, BuilderMode } from '@/lib/store/project-store';
import { downloadProjectAsZip } from '@/lib/export/zip-export';
import {
  loadProjectFromStorage,
  createNewProjectObject,
  saveProjectToStorage,
} from '@/lib/storage/project-storage';
import { ProjectsModal } from './projects-modal';
import { GitHubPushModal } from './github-push-modal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { UserMenu } from '@/components/auth/user-menu';

export function BuilderHeader() {
  const {
    files,
    framework,
    setFramework,
    mode,
    setMode,
    status,
    statusMessage,
    resetProject,
    projectId,
    projectName,
    setProjectName,
    isSaved,
    loadProjectState,
  } = useProjectStore();

  const [isExporting, setIsExporting] = useState(false);
  const [isProjectsModalOpen, setIsProjectsModalOpen] = useState(false);
  const [isGitHubModalOpen, setIsGitHubModalOpen] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(projectName);

  // Keep local input in sync with store
  React.useEffect(() => {
    setNameInput(projectName);
  }, [projectName]);

  const handleFinishRename = () => {
    setIsEditingName(false);
    const trimmed = nameInput.trim();
    if (trimmed && trimmed !== projectName) {
      setProjectName(trimmed);
    } else {
      setNameInput(projectName);
    }
  };

  const handleSelectProject = (id: string) => {
    const proj = loadProjectFromStorage(id);
    if (proj) {
      loadProjectState(proj);
      if (typeof window !== 'undefined') {
        window.history.replaceState(null, '', `/builder?id=${proj.id}`);
      }
    }
  };

  const handleNewProject = (fw: Framework = 'nextjs') => {
    const newProj = createNewProjectObject('Untitled Project', fw);
    loadProjectState(newProj);
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', `/builder?id=${newProj.id}`);
    }
  };

  const handleExport = async () => {
    try {
      setIsExporting(true);
      await downloadProjectAsZip(files, projectName || 'opendork-project');
    } catch (err) {
      console.error('Failed to export zip:', err);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <>
      <header className="h-14 border-b border-zinc-800 bg-zinc-950 px-4 flex items-center justify-between select-none z-20">
        {/* Left branding and project info */}
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2 group shrink-0">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center shadow-md shadow-blue-500/20 group-hover:scale-105 transition-transform">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-base text-zinc-100 group-hover:text-blue-400 transition-colors">
              opendork
            </span>
          </Link>

          {/* Vertical separator */}
          <span className="text-zinc-700">/</span>

          {/* Editable Project Name */}
          <div className="flex items-center gap-2">
            {isEditingName ? (
              <input
                autoFocus
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onBlur={handleFinishRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleFinishRename();
                  if (e.key === 'Escape') {
                    setNameInput(projectName);
                    setIsEditingName(false);
                  }
                }}
                className="bg-zinc-900 border border-blue-500 text-xs text-zinc-100 rounded px-2 py-0.5 focus:outline-none font-medium max-w-[160px]"
              />
            ) : (
              <button
                onClick={() => setIsEditingName(true)}
                className="flex items-center gap-1.5 text-xs font-medium text-zinc-200 hover:text-blue-400 transition-colors py-0.5 px-1 rounded hover:bg-zinc-900 max-w-[160px] truncate group cursor-pointer"
                title="Click to rename project"
              >
                <span className="truncate">{projectName}</span>
                <Edit2 className="w-2.5 h-2.5 opacity-0 group-hover:opacity-70 transition-opacity shrink-0" />
              </button>
            )}

            {/* Saved Status Indicator */}
            <span
              className={`flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded ${
                isSaved
                  ? 'text-emerald-400/80 bg-emerald-500/10'
                  : 'text-amber-400/80 bg-amber-500/10'
              }`}
              title={isSaved ? 'Auto-saved to local storage' : 'Unsaved changes'}
            >
              {isSaved ? (
                <>
                  <Check className="w-3 h-3" />
                  <span className="text-[10px]">Saved</span>
                </>
              ) : (
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              )}
            </span>
          </div>

          {/* Status indicator */}
          <div className="flex items-center gap-2 ml-1">
            <Badge
              variant={
                status === 'ready'
                  ? 'default'
                  : status === 'generating' || status === 'starting'
                  ? 'secondary'
                  : status === 'error'
                  ? 'destructive'
                  : 'outline'
              }
              className="text-[11px] font-mono capitalize py-0.5 px-2"
            >
              {status === 'generating' ? (
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-ping" />
                  Generating Code...
                </span>
              ) : status === 'starting' ? (
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                  Booting Preview...
                </span>
              ) : (
                status
              )}
            </Badge>
          </div>
        </div>

        {/* Center mode switcher */}
        <div className="flex items-center bg-zinc-900 p-0.5 rounded-lg border border-zinc-800">
          <button
            onClick={() => setMode('split')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
              mode === 'split'
                ? 'bg-zinc-800 text-zinc-100 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
            title="Split View (Code & Preview)"
          >
            <Columns className="w-3.5 h-3.5" />
            <span>Split</span>
          </button>

          <button
            onClick={() => setMode('code')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
              mode === 'code'
                ? 'bg-zinc-800 text-zinc-100 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
            title="Code Editor Only"
          >
            <Code2 className="w-3.5 h-3.5" />
            <span>Code</span>
          </button>

          <button
            onClick={() => setMode('preview')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
              mode === 'preview'
                ? 'bg-zinc-800 text-zinc-100 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
            title="Live Preview Only"
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Preview</span>
          </button>
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsProjectsModalOpen(true)}
            className="h-8 text-xs text-zinc-300 hover:text-zinc-100 hover:bg-zinc-900 border-zinc-800"
            title="Open saved projects"
          >
            <FolderKanban className="w-3.5 h-3.5 mr-1.5 text-blue-400" />
            Projects
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={resetProject}
            className="h-8 text-xs text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 border-zinc-800"
            title="Reset workspace"
          >
            <RotateCcw className="w-3.5 h-3.5 mr-1" />
            Reset
          </Button>

          {/* GitHub Push & Code Scan */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsGitHubModalOpen(true)}
            disabled={Object.keys(files).length === 0}
            className="h-8 text-xs border-zinc-800 text-zinc-200 hover:text-white hover:bg-zinc-900 shadow-sm"
            title="Scan & Push to GitHub repository"
          >
            <Github className="w-3.5 h-3.5 mr-1.5 text-zinc-100" />
            GitHub
          </Button>

          <Button
            variant="default"
            size="sm"
            onClick={handleExport}
            disabled={isExporting || Object.keys(files).length === 0}
            className="h-8 text-xs bg-blue-600 hover:bg-blue-500 text-white font-medium shadow-md shadow-blue-900/30"
          >
            <Download className="w-3.5 h-3.5 mr-1.5" />
            {isExporting ? 'Exporting...' : 'Export ZIP'}
          </Button>

          <div className="ml-1 pl-1 border-l border-zinc-800">
            <UserMenu />
          </div>
        </div>
      </header>

      {/* My Projects Modal */}
      <ProjectsModal
        isOpen={isProjectsModalOpen}
        onClose={() => setIsProjectsModalOpen(false)}
        onSelectProject={handleSelectProject}
        onNewProject={handleNewProject}
      />

      {/* GitHub Push & Code Scan Modal */}
      <GitHubPushModal
        isOpen={isGitHubModalOpen}
        onClose={() => setIsGitHubModalOpen(false)}
        files={files}
        projectName={projectName}
      />
    </>
  );
}
