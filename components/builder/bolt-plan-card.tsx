'use client';

import React, { useState } from 'react';
import {
  ListTodo,
  CheckCircle2,
  Circle,
  Loader2,
  XCircle,
  MinusCircle,
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
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  detail?: string;
  error?: string;
  subAction?: {
    type: 'read' | 'write' | 'inspect';
    target: string;
    state?: 'generating' | 'committed';
  };
}

interface BoltPlanCardProps {
  introText?: string;
  filesInspected?: string[];
  filesRead?: string[];
  filesUpdated?: string[];
  milestones?: PlanMilestone[];
  steps?: TimelineStep[];
  isStreaming?: boolean;
}

export function BoltPlanCard({
  introText,
  filesInspected = [],
  filesRead = [],
  filesUpdated = [],
  milestones = [],
  steps = [],
  isStreaming = false,
}: BoltPlanCardProps) {
  const [isFilesExpanded, setIsFilesExpanded] = useState(false);
  const [isReadFilesExpanded, setIsReadFilesExpanded] = useState(false);
  const { setActiveFile } = useProjectStore();

  // If explicit dynamic milestones are provided from the server stream, use them;
  // otherwise, build a truthful fallback checklist grounded in actual events
  const activeMilestones: PlanMilestone[] = React.useMemo(() => {
    if (milestones && milestones.length > 0) {
      return milestones;
    }

    const fileSteps = steps.filter((s) => s.type === 'file');
    const runningFileStep = fileSteps.find((s) => s.status === 'running');
    const hasAnyFiles = fileSteps.length > 0;
    const allFilesFinished = hasAnyFiles && fileSteps.every((s) => s.status === 'completed');
    const previewStep = steps.find((s) => s.type === 'preview');

    // Truthful fallback milestone pipeline (no fabricated dependency claims)
    return [
      {
        id: 'milestone-prep',
        label: 'Analyze project architecture and design system',
        status: (hasAnyFiles || allFilesFinished || !isStreaming) ? 'completed' : 'running',
      },
      {
        id: 'milestone-build',
        label: hasAnyFiles
          ? `Build application components (${fileSteps.length} files)`
          : 'Build application components and user interface',
        status: allFilesFinished
          ? 'completed'
          : hasAnyFiles
          ? 'running'
          : 'pending',
        subAction: runningFileStep?.file
          ? {
              type: 'write',
              target: runningFileStep.file,
              state: 'generating',
            }
          : undefined,
      },
      {
        id: 'milestone-verify',
        label: 'Build and verify preview sandbox',
        status: previewStep?.status === 'completed'
          ? 'completed'
          : previewStep?.status === 'running'
          ? 'running'
          : allFilesFinished && isStreaming
          ? 'running'
          : allFilesFinished && !isStreaming
          ? 'completed'
          : 'pending',
      },
    ];
  }, [milestones, steps, isStreaming]);

  // Determine updated files to show in drawer
  const displayedFiles = React.useMemo(() => {
    if (filesUpdated && filesUpdated.length > 0) {
      return filesUpdated;
    }
    if (filesInspected && filesInspected.length > 0) {
      return filesInspected;
    }
    return steps.filter((s) => s.type === 'file' && s.file).map((s) => s.file as string);
  }, [filesUpdated, filesInspected, steps]);

  // Determine context files read
  const contextReadFiles = React.useMemo(() => {
    if (filesRead && filesRead.length > 0) {
      return filesRead;
    }
    return steps.filter((s) => s.type === 'inspect' && s.file).map((s) => s.file as string);
  }, [filesRead, steps]);

  return (
    <div className="w-full space-y-3 font-sans text-xs select-none">
      {/* 1. Bolt.new Brand Identity */}
      <div className="flex items-center gap-1.5">
        <span className="font-extrabold italic text-sm tracking-tight text-zinc-100">opendork</span>
      </div>

      {/* 2. Conversational Overview */}
      {introText && (
        <p className="text-zinc-300 text-[13px] leading-relaxed font-normal whitespace-pre-line">
          {introText}
        </p>
      )}

      {/* 3a. Collapsible Files Read for Context Drawer */}
      {contextReadFiles.length > 0 && (
        <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/60 overflow-hidden">
          <button
            type="button"
            onClick={() => setIsReadFilesExpanded(!isReadFilesExpanded)}
            className="w-full px-3 py-2 flex items-center justify-between text-zinc-300 hover:text-white transition-colors bg-zinc-900/40 hover:bg-zinc-800/40 text-left"
          >
            <div className="flex items-center gap-2 text-[12px] font-medium">
              <Eye className="w-3.5 h-3.5 text-emerald-400" />
              <span>{contextReadFiles.length === 1 ? '1 file read for context' : `${contextReadFiles.length} files read for context`}</span>
            </div>
            {isReadFilesExpanded ? (
              <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />
            )}
          </button>

          {isReadFilesExpanded && (
            <div className="p-2 border-t border-zinc-800/60 space-y-1 bg-zinc-950/40 max-h-48 overflow-y-auto">
              {contextReadFiles.map((file) => (
                <div
                  key={file}
                  onClick={() => setActiveFile(file)}
                  className="flex items-center justify-between px-2 py-1.5 rounded-lg text-zinc-300 hover:bg-zinc-800/60 cursor-pointer font-mono text-[11px] transition-colors"
                >
                  <div className="flex items-center gap-2 truncate">
                    <FolderCode className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    <span className="truncate">{file}</span>
                  </div>
                  <span className="text-[10px] text-zinc-500 shrink-0 font-sans">Inspect</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 3b. Collapsible Files Updated Drawer */}
      {displayedFiles.length > 0 && (
        <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/60 overflow-hidden">
          <button
            type="button"
            onClick={() => setIsFilesExpanded(!isFilesExpanded)}
            className="w-full px-3 py-2 flex items-center justify-between text-zinc-300 hover:text-white transition-colors bg-zinc-900/40 hover:bg-zinc-800/40 text-left"
          >
            <div className="flex items-center gap-2 text-[12px] font-medium">
              <Eye className="w-3.5 h-3.5 text-zinc-400" />
              <span>{displayedFiles.length === 1 ? '1 file updated' : `${displayedFiles.length} files updated`}</span>
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
              const isFailed = milestone.status === 'failed';
              const isCancelled = milestone.status === 'cancelled';

              const subActionLabel = milestone.subAction?.type === 'write'
                ? (milestone.subAction.state === 'generating' || isRunning ? 'Generating' : 'Wrote')
                : 'Read';

              return (
                <div key={milestone.id} className="space-y-1.5">
                  <div className="flex items-start gap-2.5 text-[12px]">
                    {/* Status Icon */}
                    <div className="pt-0.5 shrink-0">
                      {isCompleted ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                      ) : isRunning ? (
                        <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                      ) : isFailed ? (
                        <XCircle className="w-4 h-4 text-red-500" />
                      ) : isCancelled ? (
                        <MinusCircle className="w-4 h-4 text-zinc-500" />
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
                          : isFailed
                          ? 'text-red-400 font-medium'
                          : isCancelled
                          ? 'text-zinc-500 line-through'
                          : 'text-zinc-500'
                      }`}
                    >
                      {milestone.label}
                    </span>
                  </div>

                  {/* Failure Diagnostic */}
                  {isFailed && milestone.error && (
                    <div className="pl-6 text-[11px] text-red-400 font-mono">
                      {milestone.error}
                    </div>
                  )}

                  {/* Sub-Action Branch */}
                  {milestone.subAction && (
                    <div className="flex items-center gap-2 pl-6 text-[11px] text-zinc-400">
                      <span className="text-zinc-600 font-mono select-none">└</span>
                      <div className="flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 px-2 py-0.5 rounded-md font-mono text-[11px] text-zinc-300">
                        {milestone.subAction.type === 'write' ? (
                          <FileEdit className="w-3 h-3 text-blue-400" />
                        ) : (
                          <Eye className="w-3 h-3 text-emerald-400" />
                        )}
                        <span className="text-zinc-400">{subActionLabel}</span>
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
