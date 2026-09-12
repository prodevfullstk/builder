'use client';

import React, { useState } from 'react';
import {
  ListTodo,
  CheckCircle2,
  Circle,
  Loader2,
  ChevronDown,
  ChevronRight,
  Eye,
  FileEdit,
  FolderCode,
} from 'lucide-react';
import { TimelineStep, useProjectStore } from '@/lib/store/project-store';

export interface PlanMilestone {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'completed';
  subAction?: {
    type: 'read' | 'write' | 'inspect';
    target: string;
  };
}

interface BoltPlanCardProps {
  introText?: string;
  filesInspected?: string[];
  milestones?: PlanMilestone[];
  steps?: TimelineStep[];
  isStreaming?: boolean;
}

export function BoltPlanCard({
  introText,
  filesInspected = [],
  milestones = [],
  steps = [],
  isStreaming = false,
}: BoltPlanCardProps) {
  const [isFilesExpanded, setIsFilesExpanded] = useState(false);
  const { setActiveFile } = useProjectStore();

  // If explicit milestones are provided, use them; otherwise, dynamically convert steps into milestones
  const activeMilestones: PlanMilestone[] = React.useMemo(() => {
    if (milestones && milestones.length > 0) {
      return milestones;
    }

    if (!steps || steps.length === 0) {
      return [];
    }

    // Convert raw timeline steps into structured milestone tasks
    const preliminary = steps.filter((s) => s.type === 'thought' || s.type === 'inspect' || s.type === 'design');
    const files = steps.filter((s) => s.type === 'file');
    const previews = steps.filter((s) => s.type === 'preview');

    const result: PlanMilestone[] = [];

    if (preliminary.length > 0) {
      const anyRunning = preliminary.some((s) => s.status === 'running');
      const allDone = preliminary.every((s) => s.status === 'completed');
      result.push({
        id: 'plan-prep',
        label: 'Analyze project requirements and setup architecture',
        status: anyRunning ? 'running' : allDone ? 'completed' : 'pending',
      });
    }

    if (files.length > 0 || isStreaming) {
      const activeFile = files.find((f) => f.status === 'running');
      const allFilesDone = files.length > 0 && files.every((f) => f.status === 'completed');
      result.push({
        id: 'plan-files',
        label: `Generate and assemble application components (${files.length} files)`,
        status: activeFile || isStreaming ? 'running' : allFilesDone ? 'completed' : 'pending',
        subAction: activeFile?.file
          ? {
              type: 'write',
              target: activeFile.file,
            }
          : undefined,
      });
    }

    if (previews.length > 0) {
      const p = previews[0];
      result.push({
        id: 'plan-verify',
        label: p.label || 'Build and verify preview sandbox',
        status: p.status,
      });
    }

    return result;
  }, [milestones, steps, isStreaming]);

  // Determine files to show in drawer (from filesInspected or from file steps)
  const displayedFiles = React.useMemo(() => {
    if (filesInspected && filesInspected.length > 0) {
      return filesInspected;
    }
    return steps.filter((s) => s.type === 'file' && s.file).map((s) => s.file as string);
  }, [filesInspected, steps]);

  return (
    <div className="w-full space-y-3 font-sans text-xs select-none">
      {/* 1. Bolt.new Brand Identity */}
      <div className="flex items-center gap-1.5">
        <span className="font-extrabold italic text-sm tracking-tight text-zinc-100">opendork</span>
      </div>

      {/* 2. 2-3 Line Conversational Overview */}
      {introText && (
        <p className="text-zinc-300 text-[13px] leading-relaxed font-normal">
          {introText}
        </p>
      )}

      {/* 3. Collapsible Files Read / Updated Drawer */}
      {displayedFiles.length > 0 && (
        <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/60 overflow-hidden">
          <button
            type="button"
            onClick={() => setIsFilesExpanded(!isFilesExpanded)}
            className="w-full px-3 py-2 flex items-center justify-between text-zinc-300 hover:text-white transition-colors bg-zinc-900/40 hover:bg-zinc-800/40 text-left"
          >
            <div className="flex items-center gap-2 text-[12px] font-medium">
              <Eye className="w-3.5 h-3.5 text-zinc-400" />
              <span>{displayedFiles.length} file{displayedFiles.length === 1 ? '' : 's'} updated</span>
            </div>
            {isFilesExpanded ? (
              <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />
            )}
          </button>

          {isFilesExpanded && (
            <div className="p-2 border-t border-zinc-800/60 space-y-1 bg-zinc-950/40 max-h-48 overflow-y-auto">
              {displayedFiles.map((file) => (
                <div
                  key={file}
                  onClick={() => setActiveFile(file)}
                  className="flex items-center justify-between px-2 py-1.5 rounded-lg text-zinc-300 hover:bg-zinc-800/60 cursor-pointer font-mono text-[11px] transition-colors"
                >
                  <div className="flex items-center gap-2 truncate">
                    <FolderCode className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                    <span className="truncate">{file}</span>
                  </div>
                  <span className="text-[10px] text-zinc-500 shrink-0 font-sans">View</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 4. Structured Plan Card */}
      {activeMilestones.length > 0 && (
        <div className="rounded-2xl border border-zinc-800/90 bg-zinc-950/80 backdrop-blur-md p-3.5 shadow-xl space-y-3">
          {/* Plan Header */}
          <div className="flex items-center gap-2 text-zinc-300 font-semibold text-[12px] tracking-wide">
            <ListTodo className="w-4 h-4 text-zinc-400" />
            <span>Plan</span>
          </div>

          {/* Checklist Items */}
          <div className="space-y-2.5">
            {activeMilestones.map((milestone) => {
              const isCompleted = milestone.status === 'completed';
              const isRunning = milestone.status === 'running';

              return (
                <div key={milestone.id} className="space-y-1.5">
                  <div className="flex items-start gap-2.5 text-[12px]">
                    {/* Status Icon */}
                    <div className="pt-0.5 shrink-0">
                      {isCompleted ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                      ) : isRunning ? (
                        <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                      ) : (
                        <Circle className="w-4 h-4 text-zinc-600" />
                      )}
                    </div>

                    {/* Milestone Label */}
                    <span
                      className={`leading-snug transition-colors ${
                        isCompleted
                          ? 'text-zinc-200'
                          : isRunning
                          ? 'text-zinc-100 font-medium'
                          : 'text-zinc-500'
                      }`}
                    >
                      {milestone.label}
                    </span>
                  </div>

                  {/* Sub-Action Branch (e.g. ↳ ✏️ Wrote components/site/hero.tsx) */}
                  {milestone.subAction && (
                    <div className="flex items-center gap-2 pl-6 text-[11px] text-zinc-400">
                      {/* Tree Branch line */}
                      <span className="text-zinc-600 font-mono select-none">└</span>
                      <div className="flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 px-2 py-0.5 rounded-md font-mono text-[11px] text-zinc-300">
                        {milestone.subAction.type === 'write' ? (
                          <FileEdit className="w-3 h-3 text-blue-400" />
                        ) : (
                          <Eye className="w-3 h-3 text-emerald-400" />
                        )}
                        <span className="text-zinc-400 capitalize">{milestone.subAction.type === 'write' ? 'Wrote' : 'Read'}</span>
                        <span className="text-zinc-200 font-semibold">{milestone.subAction.target}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
