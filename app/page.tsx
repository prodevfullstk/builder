'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Sparkles,
  ArrowRight,
  Code2,
  Cpu,
  Layers,
  Zap,
  Globe,
  CheckCircle2,
  Terminal,
} from 'lucide-react';
import { SUGGESTED_PROMPTS } from '@/lib/ai/prompt-templates';

export default function HomePage() {
  const router = useRouter();
  const [prompt, setPrompt] = useState('');
  const [selectedFramework, setSelectedFramework] = useState('nextjs');

  const handleStartBuilding = (customPrompt?: string) => {
    const finalPrompt = (customPrompt || prompt).trim();
    if (finalPrompt) {
      router.push(`/builder?prompt=${encodeURIComponent(finalPrompt)}&framework=${selectedFramework}`);
    } else {
      router.push('/builder');
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col selection:bg-blue-600 selection:text-white">
      {/* Header */}
      <header className="border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <span className="text-xl font-bold text-white tracking-tight">opendork</span>
              <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 ml-1">
                AI Web Builder
              </span>
            </div>

            <div className="flex items-center gap-4">
              <Link
                href="/test-nodebox"
                className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                Runtime Tests
              </Link>
              <button
                onClick={() => handleStartBuilding()}
                className="px-4 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-all shadow-md shadow-blue-900/30 hover:scale-105"
              >
                Open Workspace
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 pt-16 pb-24">
        <div className="max-w-4xl mx-auto text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-xs text-blue-400 font-medium mb-6">
            <Zap className="w-3.5 h-3.5 text-blue-400" />
            <span>Zero-Cost In-Browser Nodebox Runtime + Google Gemini 3.6 Flash</span>
          </div>

          <h1 className="text-5xl sm:text-6xl font-extrabold tracking-tight text-white mb-6 leading-tight">
            Build Fullstack Websites
            <br />
            <span className="bg-gradient-to-r from-blue-400 via-indigo-300 to-purple-400 bg-clip-text text-transparent">
              with Natural Language AI
            </span>
          </h1>

          <p className="text-lg text-zinc-400 mb-10 max-w-2xl mx-auto leading-relaxed">
            Prompt to production in seconds. Real Next.js, Vite, and Astro code generated, edited in Monaco, and executed live inside your browser with zero backend hosting cost.
          </p>

          {/* Interactive Prompt Input Box */}
          <div className="max-w-2xl mx-auto bg-zinc-900 border border-zinc-800 rounded-2xl p-3 shadow-2xl shadow-blue-950/20 text-left mb-8">
            <textarea
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleStartBuilding();
                }
              }}
              placeholder="Describe the website you want to build (e.g. 'Modern SaaS landing page for an AI productivity app with dark theme, pricing table, and interactive testimonials')..."
              className="w-full bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none resize-none p-2"
            />

            <div className="flex items-center justify-between pt-2 border-t border-zinc-800/80 mt-2">
              {/* Framework choices */}
              <div className="flex items-center gap-1.5">
                {[
                  { id: 'nextjs', label: 'Next.js' },
                  { id: 'vite', label: 'Vite + React' },
                  { id: 'astro', label: 'Astro' },
                ].map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setSelectedFramework(f.id)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                      selectedFramework === f.id
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'bg-zinc-800/60 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              {/* Submit CTA Button */}
              <button
                onClick={() => handleStartBuilding()}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-all shadow-md shadow-blue-900/40 hover:scale-105"
              >
                <span>Build with AI</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Quick Start Template Cards */}
          <div className="max-w-4xl mx-auto text-left">
            <div className="text-xs uppercase font-semibold text-zinc-500 mb-3 px-1 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>Or pick a quick start starter:</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {SUGGESTED_PROMPTS.map((item, idx) => (
                <div
                  key={idx}
                  onClick={() => handleStartBuilding(item.prompt)}
                  className="p-3.5 bg-zinc-900/50 hover:bg-zinc-900 border border-zinc-800/80 hover:border-zinc-700 rounded-xl cursor-pointer transition-all duration-200 group"
                >
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="text-sm font-semibold text-zinc-200 group-hover:text-blue-400 transition-colors">
                      {item.title}
                    </h3>
                    <ArrowRight className="w-3.5 h-3.5 text-zinc-500 group-hover:text-blue-400 group-hover:translate-x-0.5 transition-all" />
                  </div>
                  <p className="text-xs text-zinc-400 line-clamp-2">
                    {item.description}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Feature Highlights Grid */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-20 max-w-4xl mx-auto text-left">
            <div className="p-4 bg-zinc-900/30 border border-zinc-800 rounded-xl">
              <Code2 className="w-5 h-5 text-blue-400 mb-2" />
              <h4 className="text-sm font-semibold text-white mb-1">Monaco Editor</h4>
              <p className="text-xs text-zinc-400">Full code editing with syntax highlighting and file tree.</p>
            </div>

            <div className="p-4 bg-zinc-900/30 border border-zinc-800 rounded-xl">
              <Cpu className="w-5 h-5 text-indigo-400 mb-2" />
              <h4 className="text-sm font-semibold text-white mb-1">Nodebox Runtime</h4>
              <p className="text-xs text-zinc-400">Zero backend cost. Server runs directly in your browser.</p>
            </div>

            <div className="p-4 bg-zinc-900/30 border border-zinc-800 rounded-xl">
              <Globe className="w-5 h-5 text-emerald-400 mb-2" />
              <h4 className="text-sm font-semibold text-white mb-1">Live Preview</h4>
              <p className="text-xs text-zinc-400">Instant hot-reloading across desktop, tablet, and mobile.</p>
            </div>

            <div className="p-4 bg-zinc-900/30 border border-zinc-800 rounded-xl">
              <CheckCircle2 className="w-5 h-5 text-purple-400 mb-2" />
              <h4 className="text-sm font-semibold text-white mb-1">1-Click Export</h4>
              <p className="text-xs text-zinc-400">Download complete production-ready source code as ZIP.</p>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-900 py-6 text-center text-xs text-zinc-500">
        <p>Opendork Web · Built with Next.js 15, CodeSandbox Nodebox & Google Gemini 3.6 Flash</p>
      </footer>
    </div>
  );
}
