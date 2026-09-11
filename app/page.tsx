'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Sparkles,
  ArrowRight,
  Code2,
  Cpu,
  CheckCircle2,
  Zap,
  FolderCode,
  Clock,
  Trash2,
  Plus,
  Database,
  ExternalLink,
  ChevronRight,
  Gamepad2,
  ShoppingBag,
  LineChart,
  Bot,
} from 'lucide-react';
import {
  listSavedProjects,
  deleteProjectFromStorage,
  SavedProjectSummary,
} from '@/lib/storage/project-storage';
import { Framework } from '@/lib/store/project-store';
import { CreditsBadge } from '@/components/credits/credits-badge';
import { CreditsModal } from '@/components/credits/credits-modal';
import { UserMenu } from '@/components/auth/user-menu';
import { AuthModal } from '@/components/auth/auth-modal';

const QUICK_CATEGORIES = [
  {
    label: '✨ SaaS Platform',
    prompt: 'Build a high-converting SaaS landing page for an AI voice agent platform with dark theme, pricing toggle, FAQ accordion, and interactive testimonials.',
    framework: 'nextjs' as Framework,
    db: 'none',
  },
  {
    label: '🎮 Gamified Quest Tracker',
    prompt: 'Build a full-stack Gamified Habit & Quest Tracker web app using React (Vite), Tailwind CSS, Lucide icons, and Supabase. Include XP, streak flame counter, daily quests, and level-up celebrations.',
    framework: 'vite' as Framework,
    db: 'supabase',
  },
  {
    label: '🛍️ E-Commerce Store',
    prompt: 'Build a modern minimalist e-commerce storefront for artisanal mechanical keyboards with product showcase, category filter tabs, cart slide-over drawer, and checkout flow.',
    framework: 'nextjs' as Framework,
    db: 'supabase',
  },
  {
    label: '📊 Web3 Crypto Dashboard',
    prompt: 'Build a Web3 Crypto Portfolio Tracker dashboard with live asset charts, wallet balance cards, transaction history table with search/filter, and buy/sell modal.',
    framework: 'vite' as Framework,
    db: 'none',
  },
  {
    label: '💼 Minimalist Portfolio',
    prompt: 'Build a stunning minimalist personal developer portfolio with animated hero, project showcase cards, tech stack pills, and interactive contact modal.',
    framework: 'vite' as Framework,
    db: 'none',
  },
];

const CURATED_TEMPLATES = [
  {
    title: 'Gamified Habit & Quest Tracker',
    badge: 'Popular',
    badgeColor: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    icon: Gamepad2,
    description: 'Level-up daily quests, XP progress bar, streak flame animations, and Supabase database schema.',
    framework: 'vite' as Framework,
    db: 'supabase',
    prompt: 'Build a full-stack Gamified Habit & Quest Tracker web app using React (Vite), Tailwind CSS, Lucide icons, and Supabase.',
  },
  {
    title: 'AI Voice Platform Landing',
    badge: 'Featured',
    badgeColor: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    icon: Bot,
    description: 'Ultra-modern dark theme, dynamic pricing toggle, testimonial carousel, and high-converting CTA sections.',
    framework: 'nextjs' as Framework,
    db: 'none',
    prompt: 'Build a high-converting SaaS landing page for an AI voice agent platform. Dark theme, gradient badges, pricing table with billing toggle, FAQ accordion, and testimonial carousel.',
  },
  {
    title: 'Web3 Crypto & Asset Tracker',
    badge: 'Hot',
    badgeColor: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    icon: LineChart,
    description: 'Live price charts, portfolio asset breakdown, transaction history table, and quick swap modal.',
    framework: 'vite' as Framework,
    db: 'none',
    prompt: 'Build a Web3 Crypto Portfolio Tracker dashboard with live asset charts, wallet balance cards, transaction history table with search/filter, and buy/sell modal.',
  },
  {
    title: 'Artisanal Keyboard Storefront',
    badge: 'Fullstack',
    badgeColor: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
    icon: ShoppingBag,
    description: 'Product catalog grid, slide-over shopping cart with price math, and Supabase inventory database.',
    framework: 'nextjs' as Framework,
    db: 'supabase',
    prompt: 'Build a modern e-commerce storefront for artisanal mechanical keyboards with product grid, category tabs, cart slide-over drawer with price calculation, and quick-view modal.',
  },
];

export default function HomePage() {
  const router = useRouter();
  const [prompt, setPrompt] = useState('');
  const [recentProjects, setRecentProjects] = useState<SavedProjectSummary[]>([]);

  // Load saved projects on client mount
  useEffect(() => {
    setRecentProjects(listSavedProjects());
  }, []);

  const handleStartBuilding = (customPrompt?: string) => {
    const finalPrompt = (customPrompt || prompt).trim();
    const params = new URLSearchParams();
    if (finalPrompt) params.set('prompt', finalPrompt);

    const queryString = params.toString();
    router.push(queryString ? `/builder?${queryString}` : '/builder');
  };

  const handleOpenProject = (id: string) => {
    router.push(`/builder?id=${id}`);
  };

  const handleDeleteProject = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    deleteProjectFromStorage(id);
    setRecentProjects(listSavedProjects());
  };

  const formatRelativeTime = (timestamp: number) => {
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col selection:bg-blue-600 selection:text-white relative overflow-x-hidden">
      {/* Ambient background glows */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[450px] bg-gradient-to-b from-blue-600/15 via-indigo-600/10 to-transparent blur-[120px] pointer-events-none -z-10" />
      <div className="absolute top-[500px] right-0 w-[500px] h-[400px] bg-purple-600/5 blur-[100px] pointer-events-none -z-10" />

      {/* Header */}
      <header className="border-b border-zinc-800/80 bg-zinc-950/70 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500 via-indigo-600 to-purple-600 flex items-center justify-center shadow-lg shadow-blue-500/25">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xl font-bold tracking-tight text-white font-sans">
                  opendork
                </span>
                <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 font-medium">
                  Studio 2.5
                </span>
              </div>
            </div>

            {/* Action CTAs */}
            <div className="flex items-center gap-3">
              {/* Credits Badge */}
              <CreditsBadge />

              {/* User Profile / Login Menu */}
              <UserMenu />

              {recentProjects.length > 0 && (
                <button
                  onClick={() => router.push(`/builder?id=${recentProjects[0].id}`)}
                  className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-xs font-medium border border-zinc-800 transition-colors cursor-pointer"
                >
                  <Clock className="w-3.5 h-3.5 text-blue-400" />
                  <span>Resume Last ({recentProjects[0].name.slice(0, 14)})</span>
                </button>
              )}
              <button
                onClick={() => handleStartBuilding()}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-xl transition-all shadow-md shadow-blue-900/30 hover:scale-105 cursor-pointer"
              >
                <span>Open Workspace</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex-1 flex flex-col items-center px-4 pt-12 pb-24">
        <div className="max-w-4xl mx-auto text-center w-full">

          {/* Bold Hero Title with Underline */}
          <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight text-white mb-4 leading-[1.15]">
            Build your next website by
            <br />
            <span className="relative inline-block mt-1">
              <span className="bg-gradient-to-r from-amber-400 via-orange-400 to-amber-300 bg-clip-text text-transparent italic font-serif">
                simply describing it
              </span>
              {/* Artistic underline brush effect */}
              <svg
                className="absolute -bottom-2 left-0 w-full h-3 text-orange-500/80 overflow-visible"
                viewBox="0 0 200 9"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M2.00024 6.5C45.0002 2.5 155.5 -1.5 198 6.5"
                  stroke="currentColor"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                />
              </svg>
            </span>
          </h1>

          <p className="text-base sm:text-lg text-zinc-400 mb-8 max-w-2xl mx-auto leading-relaxed">
            Describe what you want and AI generates the full web application code with live instant preview.
            From idea to launch in seconds.
          </p>

          {/* ── Interactive Floating Prompt Box (v0 + Bolt style) ── */}
          <div
            id="prompt-box"
            className="max-w-3xl mx-auto bg-zinc-900/90 border border-zinc-800 rounded-2xl p-4 shadow-2xl shadow-blue-950/30 text-left transition-all hover:border-zinc-700/90 focus-within:border-blue-500/80 focus-within:ring-2 focus-within:ring-blue-500/20 backdrop-blur-xl mb-6"
          >
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
              placeholder="Describe the website or fullstack web app you want to build (e.g. 'Gamified Habit & Quest Tracker with streak flames, daily rewards, and Supabase database')..."
              className="w-full bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none resize-none p-1.5 leading-relaxed font-sans"
            />

            {/* Prompt Action Bar (Clean & Professional) */}
            <div className="flex items-center justify-between gap-3 pt-3 border-t border-zinc-800/80 mt-2">
              <span className="text-[11px] text-zinc-500 font-medium">
                💡 AI automatically chooses optimal framework & components
              </span>

              {/* Submit CTA */}
              <button
                type="button"
                onClick={() => handleStartBuilding()}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-semibold transition-all shadow-md shadow-blue-900/40 hover:scale-105 cursor-pointer ml-auto"
              >
                <span>Build with AI</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Quick Category Chips */}
          <div className="flex flex-wrap items-center justify-center gap-2 max-w-3xl mx-auto mb-10">
            <span className="text-xs text-zinc-500 font-medium mr-1">Quick ideas:</span>
            {QUICK_CATEGORIES.map((cat, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  setPrompt(cat.prompt);
                }}
                className="text-xs px-3 py-1.5 rounded-full bg-zinc-900 hover:bg-zinc-800/90 text-zinc-300 hover:text-white border border-zinc-800 hover:border-zinc-700 transition-all shadow-sm cursor-pointer"
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* Trust Highlights */}
          <div className="flex flex-wrap items-center justify-center gap-6 text-xs text-zinc-400 font-medium mb-16">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>Free to start, no credit card</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>Live instant preview as it builds</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>1-click SQL schema & code export</span>
            </div>
          </div>

          {/* ── 2. RECENTLY VIEWED PROJECTS (Bolt.new Image 2 style) ── */}
          <section id="recent-projects" className="w-full max-w-4xl mx-auto text-left mb-20">
            <div className="flex items-center justify-between mb-4 px-1">
              <div className="flex items-center gap-2">
                <FolderCode className="w-4 h-4 text-blue-400" />
                <h2 className="text-base font-semibold text-white tracking-tight">
                  Recently viewed projects
                </h2>
                <span className="text-xs text-zinc-500 font-mono">
                  ({recentProjects.length})
                </span>
              </div>

              {recentProjects.length > 0 && (
                <button
                  type="button"
                  onClick={() => router.push('/builder')}
                  className="text-xs text-blue-400 hover:text-blue-300 font-medium inline-flex items-center gap-1 cursor-pointer"
                >
                  <span>New project</span>
                  <Plus className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {recentProjects.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {recentProjects.slice(0, 6).map((proj) => (
                  <div
                    key={proj.id}
                    onClick={() => handleOpenProject(proj.id)}
                    className="p-4 bg-zinc-900/60 hover:bg-zinc-900 border border-zinc-800/80 hover:border-zinc-700 rounded-xl cursor-pointer transition-all duration-200 group flex flex-col justify-between relative"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <span
                          className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full border ${
                            proj.framework === 'vite'
                              ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                              : proj.framework === 'astro'
                              ? 'bg-orange-500/10 text-orange-400 border-orange-500/20'
                              : 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20'
                          }`}
                        >
                          {proj.framework.toUpperCase()}
                        </span>
                        <span className="text-[11px] text-zinc-500 flex items-center gap-1 font-mono">
                          <Clock className="w-3 h-3" />
                          {formatRelativeTime(proj.updatedAt)}
                        </span>
                      </div>

                      <h3 className="text-sm font-semibold text-zinc-200 group-hover:text-blue-400 transition-colors line-clamp-1 mb-1">
                        {proj.name || 'Untitled Project'}
                      </h3>
                      <p className="text-xs text-zinc-500">
                        {proj.fileCount || 0} source files generated
                      </p>
                    </div>

                    <div className="flex items-center justify-between pt-3 border-t border-zinc-800/50 mt-3">
                      <span className="text-[11px] text-blue-400 font-medium group-hover:underline flex items-center gap-1">
                        Open in Editor <ChevronRight className="w-3 h-3" />
                      </span>

                      <button
                        type="button"
                        onClick={(e) => handleDeleteProject(e, proj.id)}
                        className="text-zinc-600 hover:text-red-400 transition-colors p-1 rounded hover:bg-red-500/10 cursor-pointer"
                        title="Delete project"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}

                {/* + New Workspace Card */}
                <div
                  onClick={() => handleStartBuilding()}
                  className="p-4 bg-zinc-950 border border-dashed border-zinc-800 hover:border-zinc-700 rounded-xl cursor-pointer transition-all duration-200 flex flex-col items-center justify-center text-center gap-2 group min-h-[120px]"
                >
                  <div className="w-8 h-8 rounded-full bg-zinc-900 group-hover:bg-blue-600/20 group-hover:text-blue-400 text-zinc-400 flex items-center justify-center transition-colors">
                    <Plus className="w-4 h-4" />
                  </div>
                  <span className="text-xs font-semibold text-zinc-400 group-hover:text-white transition-colors">
                    Create New Project
                  </span>
                </div>
              </div>
            ) : (
              <div
                onClick={() => handleStartBuilding()}
                className="p-8 bg-zinc-900/30 border border-dashed border-zinc-800 rounded-2xl text-center cursor-pointer hover:bg-zinc-900/50 transition-colors"
              >
                <FolderCode className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
                <h3 className="text-sm font-semibold text-zinc-300 mb-1">
                  No projects saved yet
                </h3>
                <p className="text-xs text-zinc-500 max-w-sm mx-auto mb-4">
                  Write a prompt above to build your first fullstack website. It will automatically save here with 1-click restore.
                </p>
                <span className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold">
                  <Plus className="w-3.5 h-3.5" /> Start Your First Project
                </span>
              </div>
            )}
          </section>

          {/* ── 3. CURATED STARTER TEMPLATES (v0 / Lovable style) ── */}
          <section id="templates" className="w-full max-w-4xl mx-auto text-left mb-20">
            <div className="flex items-center justify-between mb-4 px-1">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-400" />
                <h2 className="text-base font-semibold text-white tracking-tight">
                  Featured Starter Templates
                </h2>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {CURATED_TEMPLATES.map((item, idx) => {
                const IconComponent = item.icon;
                return (
                  <div
                    key={idx}
                    onClick={() => handleStartBuilding(item.prompt)}
                    className="p-4 bg-zinc-900/50 hover:bg-zinc-900 border border-zinc-800/80 hover:border-zinc-700 rounded-xl cursor-pointer transition-all duration-200 group flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-2.5">
                        <div className="flex items-center gap-2">
                          <div className="p-2 rounded-lg bg-zinc-800 text-blue-400 group-hover:bg-blue-600 group-hover:text-white transition-colors">
                            <IconComponent className="w-4 h-4" />
                          </div>
                          <span
                            className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full border ${item.badgeColor}`}
                          >
                            {item.badge}
                          </span>
                        </div>
                      </div>

                      <h3 className="text-sm font-semibold text-zinc-200 group-hover:text-blue-400 transition-colors mb-1">
                        {item.title}
                      </h3>
                      <p className="text-xs text-zinc-400 line-clamp-2">
                        {item.description}
                      </p>
                    </div>

                    <div className="pt-3 border-t border-zinc-800/50 mt-3 flex items-center justify-between text-[11px] text-zinc-500">
                      <span>Ready to customize</span>
                      <span className="text-blue-400 font-medium group-hover:translate-x-0.5 transition-transform flex items-center gap-1">
                        Use Template <ArrowRight className="w-3 h-3" />
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* ── 4. CAPABILITIES / HIGHLIGHTS ── */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 max-w-4xl mx-auto text-left mb-16">
            <div className="p-4 bg-zinc-900/30 border border-zinc-800 rounded-xl">
              <Code2 className="w-5 h-5 text-blue-400 mb-2" />
              <h4 className="text-sm font-semibold text-white mb-1">Monaco Code Editor</h4>
              <p className="text-xs text-zinc-400">
                Full multi-file IDE with TypeScript syntax, file tree, and in-memory diffing.
              </p>
            </div>

            <div className="p-4 bg-zinc-900/30 border border-zinc-800 rounded-xl">
              <Cpu className="w-5 h-5 text-indigo-400 mb-2" />
              <h4 className="text-sm font-semibold text-white mb-1">In-Browser Nodebox</h4>
              <p className="text-xs text-zinc-400">
                Zero backend cost. Dev servers run directly in the browser via WebContainers.
              </p>
            </div>

            <div className="p-4 bg-zinc-900/30 border border-zinc-800 rounded-xl">
              <Database className="w-5 h-5 text-emerald-400 mb-2" />
              <h4 className="text-sm font-semibold text-white mb-1">Supabase SQL Generator</h4>
              <p className="text-xs text-zinc-400">
                Auto-generates schemas, migrations, seed data, and Row Level Security policies.
              </p>
            </div>

            <div className="p-4 bg-zinc-900/30 border border-zinc-800 rounded-xl">
              <Zap className="w-5 h-5 text-purple-400 mb-2" />
              <h4 className="text-sm font-semibold text-white mb-1">Autonomous Self-Healing</h4>
              <p className="text-xs text-zinc-400">
                Catches runtime preview errors and repairs code automatically with AI loop.
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-900 py-6 text-center text-xs text-zinc-500">
        <p>
          Opendork Web Studio · Built with Next.js 15, CodeSandbox Nodebox & Google Gemini 3.5 Flash
        </p>
      </footer>

      {/* AI Credits & Upgrade Modal */}
      <CreditsModal />

      {/* Supabase Auth & Cloud Sync Modal */}
      <AuthModal />
    </div>
  );
}
