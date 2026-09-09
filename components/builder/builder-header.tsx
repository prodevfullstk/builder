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
} from 'lucide-react';
import { useProjectStore, Framework, BuilderMode } from '@/lib/store/project-store';
import { downloadProjectAsZip } from '@/lib/export/zip-export';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

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
  } = useProjectStore();

  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    try {
      setIsExporting(true);
      await downloadProjectAsZip(files, 'opendork-project');
    } catch (err) {
      console.error('Failed to export zip:', err);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <header className="h-14 border-b border-zinc-800 bg-zinc-950 px-4 flex items-center justify-between select-none z-20">
      {/* Left branding and project info */}
      <div className="flex items-center gap-4">
        <Link href="/" className="flex items-center gap-2 group">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center shadow-md shadow-blue-500/20 group-hover:scale-105 transition-transform">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-base text-zinc-100 group-hover:text-blue-400 transition-colors">
            opendork
          </span>
        </Link>

        {/* Fullstack Project Badge */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono bg-zinc-900/80 text-zinc-300 border border-zinc-800">
          <Sparkles className="w-3.5 h-3.5 text-blue-400" />
          <span>Fullstack Project</span>
        </div>

        {/* Status indicator */}
        <div className="flex items-center gap-2">
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
          {statusMessage && (
            <span className="text-xs text-zinc-500 truncate max-w-xs">
              {statusMessage}
            </span>
          )}
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
          onClick={resetProject}
          className="h-8 text-xs text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 border-zinc-800"
          title="Reset project"
        >
          <RotateCcw className="w-3.5 h-3.5 mr-1" />
          Reset
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
      </div>
    </header>
  );
}
