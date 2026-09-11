'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Github,
  ShieldAlert,
  ShieldCheck,
  CheckCircle2,
  Lock,
  Globe,
  ExternalLink,
  Loader2,
  RefreshCw,
  AlertTriangle,
  FileCode2,
  KeyRound,
  Rocket,
  LogOut,
  Sparkles,
  X,
} from 'lucide-react';
import {
  verifyGitHubToken,
  createGitHubRepository,
  pushProjectToGitHub,
  GitHubUser,
} from '@/lib/export/github-export';
import { runCodeScan, ScanReport } from '@/lib/export/code-scanner';

interface GitHubPushModalProps {
  isOpen: boolean;
  onClose: () => void;
  files: Record<string, string>;
  projectName?: string;
}

export function GitHubPushModal({
  isOpen,
  onClose,
  files,
  projectName = 'opendork-project',
}: GitHubPushModalProps) {
  const [token, setToken] = useState('');
  const [user, setUser] = useState<GitHubUser | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Repo configuration
  const [repoName, setRepoName] = useState('');
  const [description, setDescription] = useState('Built with Opendrok AI Web Builder');
  const [isPrivate, setIsPrivate] = useState(false);
  const [commitMessage, setCommitMessage] = useState('Initial commit from Opendrok AI Web Builder');

  // Navigation tab: 'setup' | 'scan' | 'result'
  const [activeTab, setActiveTab] = useState<'setup' | 'scan' | 'result'>('setup');

  // Scanner state
  const [scanReport, setScanReport] = useState<ScanReport | null>(null);
  const [isScanning, setIsScanning] = useState(false);

  // Push state
  const [isPushing, setIsPushing] = useState(false);
  const [pushProgress, setPushProgress] = useState('');
  const [pushError, setPushError] = useState<string | null>(null);
  const [pushResult, setPushResult] = useState<{ commitUrl?: string; repoUrl?: string } | null>(null);

  // Initialize from localStorage and default repo name
  useEffect(() => {
    if (isOpen) {
      const sanitized = projectName
        .toLowerCase()
        .replace(/[^a-z0-9._-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
      setRepoName(sanitized || 'my-ai-web-app');

      const savedToken = localStorage.getItem('opendrok_github_token');
      if (savedToken && !user) {
        setToken(savedToken);
        handleVerifyToken(savedToken);
      }

      // Initial run of code scanner
      handleRunScan();
    }
  }, [isOpen, projectName]);

  if (!isOpen) return null;

  const handleVerifyToken = async (tokenToVerify?: string) => {
    const t = tokenToVerify || token;
    if (!t.trim()) {
      setAuthError('Please enter a GitHub Personal Access Token.');
      return;
    }

    setIsVerifying(true);
    setAuthError(null);

    const res = await verifyGitHubToken(t);
    setIsVerifying(false);

    if (res.success && res.user) {
      setUser(res.user);
      localStorage.setItem('opendrok_github_token', t.trim());
      setAuthError(null);
    } else {
      setUser(null);
      setAuthError(res.error || 'Token verification failed.');
    }
  };

  const handleDisconnect = () => {
    localStorage.removeItem('opendrok_github_token');
    setUser(null);
    setToken('');
  };

  const handleRunScan = () => {
    setIsScanning(true);
    try {
      const report = runCodeScan(files);
      setScanReport(report);
    } finally {
      setIsScanning(false);
    }
  };

  const handlePush = async () => {
    if (!token || !user) {
      setActiveTab('setup');
      setAuthError('Please connect your GitHub account first.');
      return;
    }

    const cleanRepoName = repoName.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '-');
    if (!cleanRepoName) {
      setActiveTab('setup');
      setPushError('Please provide a valid repository name.');
      return;
    }

    setIsPushing(true);
    setPushError(null);
    setPushProgress('Creating repository on GitHub...');

    // 1. Create Repository
    const createRes = await createGitHubRepository(token, {
      name: cleanRepoName,
      description,
      isPrivate,
    });

    if (!createRes.success || !createRes.repo) {
      setIsPushing(false);
      setPushError(createRes.error || 'Failed to create repository.');
      return;
    }

    // 2. Push files using Git Database Tree API
    const pushRes = await pushProjectToGitHub(
      token,
      user.login,
      cleanRepoName,
      files,
      commitMessage,
      (status) => setPushProgress(status)
    );

    setIsPushing(false);

    if (pushRes.success && pushRes.repoUrl) {
      setPushResult({
        repoUrl: pushRes.repoUrl,
        commitUrl: pushRes.commitUrl,
      });
      setActiveTab('result');
    } else {
      setPushError(pushRes.error || 'Failed to push files to GitHub repository.');
    }
  };

  const fileCount = Object.keys(files).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-2xl bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh] text-zinc-100">
        {/* Header */}
        <div className="p-5 border-b border-zinc-800/80 bg-gradient-to-r from-zinc-900 via-zinc-950 to-zinc-900 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-zinc-800/80 border border-zinc-700 flex items-center justify-center text-white shadow-inner">
              <Github className="w-5 h-5" />
            </div>
            <div>
              <div className="text-base font-semibold text-zinc-100 flex items-center gap-2">
                Push to GitHub
                <Badge variant="outline" className="text-[10px] bg-blue-500/10 text-blue-400 border-blue-500/30">
                  Git Trees API
                </Badge>
              </div>
              <div className="text-xs text-zinc-400 mt-0.5">
                Scan project files, create a new repository, and push in one click.
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Step Tabs */}
            <div className="flex items-center bg-zinc-900 border border-zinc-800 rounded-lg p-0.5 text-xs">
              <button
                onClick={() => setActiveTab('setup')}
                disabled={isPushing}
                className={`px-3 py-1 rounded-md transition-all cursor-pointer ${
                  activeTab === 'setup'
                    ? 'bg-blue-600 text-white font-medium shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                1. Repo Setup
              </button>
              <button
                onClick={() => {
                  handleRunScan();
                  setActiveTab('scan');
                }}
                disabled={isPushing}
                className={`px-3 py-1 rounded-md transition-all flex items-center gap-1.5 cursor-pointer ${
                  activeTab === 'scan'
                    ? 'bg-blue-600 text-white font-medium shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                2. Code Scan
                {scanReport?.hasCriticalIssues && (
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                )}
              </button>
              {pushResult && (
                <button
                  onClick={() => setActiveTab('result')}
                  className={`px-3 py-1 rounded-md transition-all cursor-pointer ${
                    activeTab === 'result'
                      ? 'bg-blue-600 text-white font-medium shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  3. Result
                </button>
              )}
            </div>

            <button
              onClick={onClose}
              disabled={isPushing}
              className="text-zinc-500 hover:text-zinc-200 p-1.5 rounded-lg hover:bg-zinc-800/60 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {/* TAB 1: SETUP */}
          {activeTab === 'setup' && (
            <div className="space-y-5">
              {/* GitHub Auth Box */}
              {!user ? (
                <div className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-zinc-300 flex items-center gap-2">
                      <KeyRound className="w-4 h-4 text-yellow-400" />
                      GitHub Personal Access Token (PAT)
                    </label>
                    <a
                      href="https://github.com/settings/tokens/new?scopes=repo&description=Opendrok%20AI%20Web%20Builder"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] text-blue-400 hover:text-blue-300 underline flex items-center gap-1"
                    >
                      Generate 1-click token <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>

                  <div className="flex gap-2">
                    <input
                      type="password"
                      placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxx (requires repo scope)"
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-blue-500"
                    />
                    <Button
                      size="sm"
                      onClick={() => handleVerifyToken()}
                      disabled={isVerifying || !token.trim()}
                      className="bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-xs px-4"
                    >
                      {isVerifying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Connect'}
                    </Button>
                  </div>

                  {authError && (
                    <p className="text-xs text-red-400 flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      {authError}
                    </p>
                  )}

                  <p className="text-[11px] text-zinc-500 leading-relaxed">
                    Token is securely stored locally in your browser to authorize repository creation and commits via GitHub REST API.
                  </p>
                </div>
              ) : (
                <div className="flex items-center justify-between p-3.5 rounded-xl bg-zinc-900/70 border border-zinc-800">
                  <div className="flex items-center gap-3">
                    <img
                      src={user.avatar_url}
                      alt={user.login}
                      className="w-10 h-10 rounded-full border border-zinc-700 shadow-sm"
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-zinc-100">{user.name || user.login}</span>
                        <span className="text-[11px] text-zinc-400 font-mono">@{user.login}</span>
                      </div>
                      <span className="text-[11px] text-emerald-400 flex items-center gap-1 mt-0.5">
                        <CheckCircle2 className="w-3 h-3" /> Connected & Authorized
                      </span>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleDisconnect}
                    className="h-8 text-xs text-zinc-400 hover:text-red-400 hover:bg-red-500/10"
                    title="Disconnect GitHub account"
                  >
                    <LogOut className="w-3.5 h-3.5 mr-1.5" /> Disconnect
                  </Button>
                </div>
              )}

              {/* Repo Setup Form */}
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-300">Repository Name</label>
                  <div className="flex items-center rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 focus-within:border-blue-500">
                    <span className="text-xs text-zinc-500 font-mono select-none">
                      {user ? `${user.login}/` : 'github.com/'}
                    </span>
                    <input
                      type="text"
                      value={repoName}
                      onChange={(e) => setRepoName(e.target.value)}
                      placeholder="my-ai-web-app"
                      className="flex-1 bg-transparent text-xs text-zinc-100 font-mono focus:outline-none ml-0.5"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-300">Description (optional)</label>
                  <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Short description of your project"
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-blue-500"
                  />
                </div>

                {/* Visibility Toggle */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-300">Visibility</label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setIsPrivate(false)}
                      className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-all cursor-pointer ${
                        !isPrivate
                          ? 'border-blue-500/50 bg-blue-500/10 text-white'
                          : 'border-zinc-800 bg-zinc-900/40 text-zinc-400 hover:border-zinc-700'
                      }`}
                    >
                      <Globe className={`w-4 h-4 ${!isPrivate ? 'text-blue-400' : 'text-zinc-500'}`} />
                      <div>
                        <div className="text-xs font-medium">Public</div>
                        <div className="text-[10px] text-zinc-500">Anyone on the internet can see this repo.</div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setIsPrivate(true)}
                      className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-all cursor-pointer ${
                        isPrivate
                          ? 'border-blue-500/50 bg-blue-500/10 text-white'
                          : 'border-zinc-800 bg-zinc-900/40 text-zinc-400 hover:border-zinc-700'
                      }`}
                    >
                      <Lock className={`w-4 h-4 ${isPrivate ? 'text-blue-400' : 'text-zinc-500'}`} />
                      <div>
                        <div className="text-xs font-medium">Private</div>
                        <div className="text-[10px] text-zinc-500">Only you choose who can see and commit.</div>
                      </div>
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-300">Commit Message</label>
                  <input
                    type="text"
                    value={commitMessage}
                    onChange={(e) => setCommitMessage(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-300 font-mono focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: CODE SCAN */}
          {activeTab === 'scan' && (
            <div className="space-y-4">
              {/* Scan summary banner */}
              <div className="flex items-center justify-between p-4 rounded-xl bg-zinc-900/70 border border-zinc-800">
                <div className="flex items-center gap-3">
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                      scanReport?.hasCriticalIssues
                        ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                        : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    }`}
                  >
                    {scanReport?.hasCriticalIssues ? (
                      <ShieldAlert className="w-5 h-5" />
                    ) : (
                      <ShieldCheck className="w-5 h-5" />
                    )}
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-zinc-100 flex items-center gap-2">
                      Code Security & Integrity Scan
                      <Badge
                        variant="outline"
                        className={
                          scanReport?.hasCriticalIssues
                            ? 'bg-red-500/10 text-red-400 border-red-500/30'
                            : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                        }
                      >
                        Score: {scanReport?.score ?? 100}/100
                      </Badge>
                    </div>
                    <div className="text-[11px] text-zinc-400 mt-0.5">
                      {scanReport?.hasCriticalIssues
                        ? 'Critical security or syntax issues found. Review before pushing.'
                        : 'Passed security checks. No leaked secrets detected.'}
                    </div>
                  </div>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRunScan}
                  disabled={isScanning}
                  className="h-8 text-xs border-zinc-800 text-zinc-300 hover:text-zinc-100 cursor-pointer"
                >
                  <RefreshCw className={`w-3 h-3 mr-1.5 ${isScanning ? 'animate-spin' : ''}`} />
                  Re-Scan
                </Button>
              </div>

              {/* Stats overview */}
              {scanReport && (
                <div className="grid grid-cols-4 gap-2 text-center">
                  <div className="p-2.5 rounded-lg bg-zinc-900/40 border border-zinc-800">
                    <div className="text-xs text-zinc-400">Total Files</div>
                    <div className="text-sm font-semibold text-zinc-200">{scanReport.totalFiles}</div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-zinc-900/40 border border-zinc-800">
                    <div className="text-xs text-zinc-400">Total LOC</div>
                    <div className="text-sm font-semibold text-zinc-200">{scanReport.totalLines}</div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-zinc-900/40 border border-zinc-800">
                    <div className="text-xs text-zinc-400">TypeScript</div>
                    <div className="text-sm font-semibold text-blue-400">{scanReport.stats.tsCount} files</div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-zinc-900/40 border border-zinc-800">
                    <div className="text-xs text-zinc-400">package.json</div>
                    <div className="text-sm font-semibold text-emerald-400">
                      {scanReport.stats.hasPackageJson ? 'Valid ✓' : 'Missing ✕'}
                    </div>
                  </div>
                </div>
              )}

              {/* Issue list */}
              <div className="space-y-2">
                <div className="text-xs font-semibold text-zinc-400">Scan Findings</div>
                {scanReport?.issues.length === 0 ? (
                  <div className="p-4 rounded-lg bg-emerald-500/5 border border-emerald-500/20 text-center text-xs text-emerald-400 flex items-center justify-center gap-2">
                    <CheckCircle2 className="w-4 h-4" />
                    All {scanReport.totalFiles} files verified clean. Ready to push to GitHub!
                  </div>
                ) : (
                  <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                    {scanReport?.issues.map((issue) => (
                      <div
                        key={issue.id}
                        className={`p-3 rounded-lg border text-xs space-y-1 ${
                          issue.severity === 'critical'
                            ? 'bg-red-500/10 border-red-500/30 text-red-200'
                            : issue.severity === 'warning'
                            ? 'bg-amber-500/10 border-amber-500/30 text-amber-200'
                            : 'bg-zinc-900 border-zinc-800 text-zinc-300'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold flex items-center gap-1.5">
                            {issue.severity === 'critical' && <ShieldAlert className="w-3.5 h-3.5 text-red-400" />}
                            {issue.severity === 'warning' && <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />}
                            {issue.message}
                          </span>
                          {issue.file && (
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/40 text-zinc-300">
                              {issue.file} {issue.line ? `:${issue.line}` : ''}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-zinc-400">{issue.recommendation}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: RESULT */}
          {activeTab === 'result' && pushResult && (
            <div className="p-6 text-center space-y-4">
              <div className="w-12 h-12 mx-auto rounded-2xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-lg shadow-emerald-500/10">
                <Sparkles className="w-6 h-6" />
              </div>

              <div>
                <h3 className="text-base font-semibold text-zinc-100">Repository Pushed Successfully!</h3>
                <p className="text-xs text-zinc-400 mt-1">
                  All {fileCount} project files have been committed to your new GitHub repository.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
                <a
                  href={pushResult.repoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-xs font-medium border border-zinc-700 transition-all shadow-sm"
                >
                  <Github className="w-4 h-4" />
                  View on GitHub
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>

                <a
                  href={`https://vercel.com/new/git/external?repository-url=${encodeURIComponent(pushResult.repoUrl || '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-all shadow-md shadow-blue-600/30"
                >
                  <Rocket className="w-4 h-4" />
                  Deploy to Vercel
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>
          )}

          {/* Push Error Message */}
          {pushError && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="flex-1">{pushError}</div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-zinc-800/80 bg-zinc-900/40 flex items-center justify-between">
          <div className="text-xs text-zinc-500">
            {isPushing ? (
              <span className="flex items-center gap-2 text-blue-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {pushProgress || 'Pushing to GitHub...'}
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <FileCode2 className="w-3.5 h-3.5 text-zinc-400" />
                {fileCount} files in virtual filesystem
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onClose}
              disabled={isPushing}
              className="h-8 text-xs border-zinc-800 text-zinc-400 hover:text-zinc-200 cursor-pointer"
            >
              {activeTab === 'result' ? 'Close' : 'Cancel'}
            </Button>

            {activeTab !== 'result' && (
              <Button
                size="sm"
                onClick={handlePush}
                disabled={isPushing || fileCount === 0 || !user}
                className="h-8 text-xs bg-blue-600 hover:bg-blue-500 text-white font-medium shadow-md shadow-blue-900/30 gap-1.5 cursor-pointer"
              >
                {isPushing ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Pushing...
                  </>
                ) : (
                  <>
                    <Github className="w-3.5 h-3.5" />
                    Push to GitHub
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
