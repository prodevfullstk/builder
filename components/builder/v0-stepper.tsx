'use client';

import React, { useState, useMemo } from 'react';
import {
  Brain,
  Search,
  Palette,
  FileCode,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Monitor,
  Loader2,
  ExternalLink,
} from 'lucide-react';
import { TimelineStep, useProjectStore } from '@/lib/store/project-store';
import { generateInstantPreviewHtml } from '@/lib/preview/instant-preview-html';

interface V0StepperProps {
  steps: TimelineStep[];
  filesGenerated?: string[];
  showPreview?: boolean;
  content?: string;
  isStreaming?: boolean;
}

export function V0Stepper({
  steps,
  filesGenerated = [],
  showPreview = true,
  content = '',
  isStreaming = false,
}: V0StepperProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const { files, setMode, setActiveFile } = useProjectStore();

  const previewHtml = useMemo(() => {
    if (!files || Object.keys(files).length === 0) return '';
    try {
      return generateInstantPreviewHtml(files);
    } catch {
      return '';
    }
  }, [files]);

  const getStepIcon = (type: TimelineStep['type'], status: TimelineStep['status']) => {
    if (status === 'running') {
      return <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin shrink-0" />;
    }
    if (type === 'thought') {
      return <Brain className="w-3.5 h-3.5 text-zinc-400 shrink-0" />;
    }
    if (type === 'inspect') {
      return <Search className="w-3.5 h-3.5 text-zinc-400 shrink-0" />;
    }
    if (type === 'design') {
      return <Palette className="w-3.5 h-3.5 text-zinc-400 shrink-0" />;
    }
    if (type === 'preview') {
      return <Monitor className="w-3.5 h-3.5 text-zinc-400 shrink-0" />;
    }
    return <FileCode className="w-3.5 h-3.5 text-blue-400 shrink-0" />;
  };

  return (
    <div className="space-y-3 text-xs">
      {/* Stepper Timeline Container */}
      <div className="bg-zinc-950/70 border border-zinc-800/80 rounded-xl overflow-hidden backdrop-blur-sm">
        {/* Toggle Header */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full px-3 py-2 flex items-center justify-between text-zinc-400 hover:text-zinc-200 transition-colors bg-zinc-900/40 border-b border-zinc-800/40"
        >
          <div className="flex items-center gap-2 font-medium text-[11px]">
            {isStreaming ? (
              <span className="flex items-center gap-1.5 text-blue-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Building website...</span>
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>Finished building</span>
              </span>
            )}
            <span className="text-zinc-600">•</span>
            <span className="text-zinc-500 font-normal">
              {steps.length} step{steps.length === 1 ? '' : 's'}
            </span>
          </div>

          {isExpanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />
          )}
        </button>

        {/* Steps List */}
        {isExpanded && (
          <div className="p-2.5 space-y-1.5">
            {steps.map((step) => {
              const isRunning = step.status === 'running';
              return (
                <div
                  key={step.id}
                  onClick={() => {
                    if (step.file) setActiveFile(step.file);
                  }}
                  className={`flex items-center justify-between px-2 py-1.5 rounded-lg transition-colors ${
                    step.file ? 'cursor-pointer hover:bg-zinc-900/80' : ''
                  } ${isRunning ? 'bg-blue-500/10 border border-blue-500/20 text-blue-300' : 'text-zinc-300'}`}
                >
                  <div className="flex items-center gap-2 truncate">
                    {getStepIcon(step.type, step.status)}
                    <span className="font-mono text-[11px] truncate">{step.label}</span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0 text-[10px]">
                    {step.linesAdded !== undefined && (
                      <span className="px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">
                        +{step.linesAdded}
                      </span>
                    )}
                    {step.duration && (
                      <span className="text-zinc-500 font-mono">{step.duration}</span>
                    )}
                    {step.file && (
                      <span className="text-[10px] text-zinc-500 font-mono px-1 rounded bg-zinc-800/60">
                        v1
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Inline Miniature Preview Card (v0-style) */}
      {showPreview && !isStreaming && previewHtml && (
        <div className="rounded-xl border border-zinc-800 overflow-hidden bg-zinc-950 shadow-lg group">
          {/* Card Header Bar */}
          <div className="px-3 py-1.5 bg-zinc-900/90 border-b border-zinc-800 flex items-center justify-between text-[11px] text-zinc-400">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span className="font-medium text-zinc-200">Live Preview</span>
            </div>
            <button
              onClick={() => setMode('preview')}
              className="flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
            >
              <span>Full View</span>
              <ExternalLink className="w-3 h-3" />
            </button>
          </div>

          {/* Miniature Iframe Thumbnail Container */}
          <div
            onClick={() => setMode('preview')}
            className="relative w-full h-44 bg-zinc-900 cursor-pointer overflow-hidden"
            title="Click to view full preview"
          >
            <iframe
              srcDoc={previewHtml}
              title="Miniature Preview"
              className="w-[200%] h-[200%] origin-top-left scale-50 pointer-events-none border-none bg-white"
              sandbox="allow-scripts allow-same-origin"
            />
            {/* Hover Overlay */}
            <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-xs">
              <span className="px-2.5 py-1 rounded-md bg-blue-600 text-white font-medium text-xs shadow-md">
                Open Full Preview →
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Summary Description */}
      {content && (
        <div className="text-zinc-300 leading-relaxed text-xs">
          <p className="whitespace-pre-wrap">{content}</p>
        </div>
      )}
    </div>
  );
}
