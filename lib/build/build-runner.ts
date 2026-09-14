import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn } from 'node:child_process';

export interface BuildResult {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  command?: string;
  error?: string;
}

export interface SmokeTestResult {
  success: boolean;
  statusCode?: number;
  responseBodySnippet?: string;
  durationMs: number;
  error?: string;
}

export interface RunningServer {
  url: string;
  stop: () => Promise<void>;
}

export interface BuildRunner {
  readonly name: string;
  prepare(files: Record<string, string>): Promise<void>;
  install(timeoutMs?: number): Promise<BuildResult>;
  build(timeoutMs?: number): Promise<BuildResult>;
  start(port?: number, timeoutMs?: number): Promise<RunningServer>;
  smokeTest(url: string, timeoutMs?: number): Promise<SmokeTestResult>;
  cleanup(): Promise<void>;
}

/**
 * Terminates a process and its child process tree cross-platform.
 */
function killProcessTree(pid: number | undefined): void {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      process.kill(-pid, 'SIGKILL');
    }
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {}
  }
}

/**
 * Builds a strictly sanitized environment allowlist.
 * Never passes through host application secrets, database URLs, or API keys.
 */
export function getSafeChildEnvironment(extraEnv?: Record<string, string>): NodeJS.ProcessEnv {
  const safeEnv: NodeJS.ProcessEnv = {
    PATH: process.env.PATH || '',
    SYSTEMROOT: process.env.SYSTEMROOT || '',
    WINDIR: process.env.WINDIR || '',
    APPDATA: process.env.APPDATA || '',
    LOCALAPPDATA: process.env.LOCALAPPDATA || '',
    HOME: os.tmpdir(),
    USERPROFILE: os.tmpdir(),
    TMPDIR: os.tmpdir(),
    TEMP: os.tmpdir(),
    TMP: os.tmpdir(),
    CI: 'true',
    NODE_ENV: 'development',
    ...(extraEnv || {}),
  };

  // Explicit blacklist guard: assert that no sensitive credentials exist
  const SENSITIVE_KEYS = [
    'DATABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_ANON_KEY',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'GROQ_API_KEY',
    'GEMINI_API_KEY',
    'GOOGLE_API_KEY',
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'VERCEL_TOKEN',
    'VERCEL_PROJECT_ID',
    'VERCEL_SANDBOX_TOKEN',
    'GITHUB_TOKEN',
  ];

  for (const key of SENSITIVE_KEYS) {
    delete safeEnv[key];
  }

  return safeEnv;
}

/**
 * Executes a child process with strict environment isolation, timeout enforcement,
 * and process-tree termination.
 */
function runCommand(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  extraEnv?: Record<string, string>
): Promise<BuildResult> {
  const startTime = Date.now();
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const isWindows = process.platform === 'win32';
    const child = spawn(cmd, args, {
      cwd,
      shell: isWindows,
      env: getSafeChildEnvironment(extraEnv),
    });

    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child.pid);
    }, timeoutMs);

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      const durationMs = Date.now() - startTime;
      resolve({
        success: false,
        exitCode: -1,
        stdout,
        stderr: stderr || err.message,
        durationMs,
        command: `${cmd} ${args.join(' ')}`,
        error: err.message,
      });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const durationMs = Date.now() - startTime;
      if (timedOut) {
        resolve({
          success: false,
          exitCode: -1,
          stdout,
          stderr: stderr + `\nProcess timed out after ${timeoutMs}ms`,
          durationMs,
          command: `${cmd} ${args.join(' ')}`,
          error: `Execution timed out after ${timeoutMs}ms`,
        });
      } else {
        resolve({
          success: code === 0,
          exitCode: code ?? 0,
          stdout,
          stderr,
          durationMs,
          command: `${cmd} ${args.join(' ')}`,
        });
      }
    });
  });
}

/**
 * LocalBuildRunner executes real build verification in a clean temporary directory.
 * Marked STRICTLY development-only: refuses to run in production mode (SEC-303).
 */
export class LocalBuildRunner implements BuildRunner {
  readonly name = 'LocalBuildRunner';
  private tempDir: string | null = null;
  private runningChild: any = null;

  private assertEnvironment(): void {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'Security Violation: LocalBuildRunner is disabled in production. Bare-host execution of untrusted generated projects is strictly prohibited.'
      );
    }
  }

  async prepare(files: Record<string, string>): Promise<void> {
    this.assertEnvironment();
    const id = Math.random().toString(36).substring(2, 10);
    this.tempDir = path.join(os.tmpdir(), `opendrok-build-${id}`);
    await fs.mkdir(this.tempDir, { recursive: true });

    const root = path.resolve(this.tempDir);

    for (const [filePath, content] of Object.entries(files)) {
      // Security Invariant (SEC-303): Canonical relative path containment check
      if (
        filePath.includes('\0') ||
        /^[a-zA-Z]:/.test(filePath) ||
        filePath.startsWith('\\\\') ||
        filePath.startsWith('//')
      ) {
        throw new Error(`Path traversal attempt detected: ${filePath}`);
      }

      const target = path.resolve(root, filePath);
      const relative = path.relative(root, target);

      if (
        relative === '..' ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative)
      ) {
        throw new Error(`Path traversal attempt detected: ${filePath}`);
      }

      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content, 'utf-8');
    }
  }

  getTempDir(): string | null {
    return this.tempDir;
  }

  async install(timeoutMs = 60000): Promise<BuildResult> {
    this.assertEnvironment();
    if (!this.tempDir) throw new Error('Runner not prepared. Call prepare() first.');
    // Security Invariant (SEC-303): --ignore-scripts is mandatory to prevent malicious lifecycle execution
    return runCommand('pnpm', ['install', '--prefer-offline', '--ignore-scripts'], this.tempDir, timeoutMs);
  }

  async build(timeoutMs = 60000): Promise<BuildResult> {
    this.assertEnvironment();
    if (!this.tempDir) throw new Error('Runner not prepared. Call prepare() first.');
    return runCommand('pnpm', ['build'], this.tempDir, timeoutMs);
  }

  async start(port = 3001, timeoutMs = 15000): Promise<RunningServer> {
    this.assertEnvironment();
    if (!this.tempDir) throw new Error('Runner not prepared. Call prepare() first.');
    const startTime = Date.now();
    const url = `http://127.0.0.1:${port}`;

    const isWindows = process.platform === 'win32';
    const child = spawn('pnpm', ['start', '--port', String(port)], {
      cwd: this.tempDir,
      shell: isWindows,
      env: getSafeChildEnvironment({ PORT: String(port) }),
    });
    this.runningChild = child;

    // Wait for server to become responsive or timeout
    const deadline = startTime + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(url);
        if (res.ok || res.status < 500) {
          break;
        }
      } catch {
        await new Promise((r) => setTimeout(r, 400));
      }
    }

    const stop = async () => {
      if (this.runningChild) {
        killProcessTree(this.runningChild.pid);
        this.runningChild = null;
      }
    };

    return { url, stop };
  }

  async smokeTest(url: string, timeoutMs = 5000): Promise<SmokeTestResult> {
    const startTime = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, { signal: controller.signal });
      const text = await res.text();
      clearTimeout(timer);
      const durationMs = Date.now() - startTime;
      return {
        success: res.status >= 200 && res.status < 400,
        statusCode: res.status,
        responseBodySnippet: text.slice(0, 300),
        durationMs,
      };
    } catch (err: any) {
      clearTimeout(timer);
      const durationMs = Date.now() - startTime;
      return {
        success: false,
        durationMs,
        error: err?.message || 'Smoke test request failed',
      };
    }
  }

  async cleanup(): Promise<void> {
    if (this.runningChild) {
      killProcessTree(this.runningChild.pid);
      this.runningChild = null;
    }
    if (this.tempDir) {
      try {
        await fs.rm(this.tempDir, { recursive: true, force: true });
      } catch {}
      this.tempDir = null;
    }
  }
}

/**
 * VercelSandboxRunner provides integration with Vercel Sandbox microVMs.
 * Executes real isolated dependency installation, framework builds, and HTTP smoke tests.
 */
export class VercelSandboxRunner implements BuildRunner {
  readonly name = 'VercelSandboxRunner';
  private sandboxInstance: any = null;
  private preparedFiles: Record<string, string> = {};

  private hasCredentials(): boolean {
    return Boolean(process.env.VERCEL_TOKEN && (process.env.VERCEL_PROJECT_ID || process.env.VERCEL_TEAM_ID));
  }

  async prepare(files: Record<string, string>): Promise<void> {
    this.preparedFiles = { ...files };
    if (!this.hasCredentials()) {
      return;
    }

    // Dynamic import @vercel/sandbox
    const { Sandbox } = await import('@vercel/sandbox');
    this.sandboxInstance = await Sandbox.create({
      token: process.env.VERCEL_TOKEN!,
      projectId: process.env.VERCEL_PROJECT_ID,
      teamId: process.env.VERCEL_TEAM_ID,
      timeout: 180_000,
      ports: [3000, 3001, 4173, 5173],
    });

    // Write all project files into the remote sandbox filesystem
    const fileEntries = Object.entries(files).map(([path, content]) => ({
      path: path.startsWith('/') ? path.slice(1) : path,
      content,
    }));

    if (fileEntries.length > 0) {
      await this.sandboxInstance.writeFiles(fileEntries);
    }
  }

  async install(timeoutMs = 120_000): Promise<BuildResult> {
    if (!this.hasCredentials()) {
      return {
        success: false,
        exitCode: 1,
        stdout: '',
        stderr: 'Verification Unavailable: Vercel credentials (VERCEL_TOKEN) are not configured.',
        durationMs: 0,
        error: 'Credentials Missing',
      };
    }

    if (!this.sandboxInstance) {
      await this.prepare(this.preparedFiles);
    }

    const startTime = Date.now();
    try {
      const cmd = await this.sandboxInstance.runCommand('npm', ['install', '--prefer-offline', '--no-audit', '--no-fund'], {
        timeout: timeoutMs,
      });
      const stdout = await cmd.stdout();
      const stderr = await cmd.stderr();
      const finished = await cmd.wait();
      const exitCode = finished.exitCode ?? 0;

      return {
        success: exitCode === 0,
        exitCode,
        stdout,
        stderr,
        durationMs: Date.now() - startTime,
        command: 'npm install',
      };
    } catch (err: any) {
      return {
        success: false,
        exitCode: 1,
        stdout: '',
        stderr: err?.message || 'Sandbox install failed',
        durationMs: Date.now() - startTime,
        error: err?.message,
      };
    }
  }

  async build(timeoutMs = 120_000): Promise<BuildResult> {
    if (!this.hasCredentials()) {
      return {
        success: false,
        exitCode: 1,
        stdout: '',
        stderr: 'Verification Unavailable: Vercel credentials (VERCEL_TOKEN) are not configured.',
        durationMs: 0,
        error: 'Credentials Missing',
      };
    }

    if (!this.sandboxInstance) {
      await this.prepare(this.preparedFiles);
    }

    const startTime = Date.now();
    try {
      const cmd = await this.sandboxInstance.runCommand('npm', ['run', 'build'], {
        timeout: timeoutMs,
      });
      const stdout = await cmd.stdout();
      const stderr = await cmd.stderr();
      const finished = await cmd.wait();
      const exitCode = finished.exitCode ?? 0;

      return {
        success: exitCode === 0,
        exitCode,
        stdout,
        stderr,
        durationMs: Date.now() - startTime,
        command: 'npm run build',
      };
    } catch (err: any) {
      return {
        success: false,
        exitCode: 1,
        stdout: '',
        stderr: err?.message || 'Sandbox build failed',
        durationMs: Date.now() - startTime,
        error: err?.message,
      };
    }
  }

  async start(port = 3000, timeoutMs = 30_000): Promise<RunningServer> {
    if (!this.hasCredentials() || !this.sandboxInstance) {
      throw new Error('Verification Unavailable: Vercel sandbox is not active or configured.');
    }

    let startCmd = 'npm';
    let startArgs = ['start', '--', '-p', String(port)];

    if (this.preparedFiles && this.preparedFiles['package.json']) {
      try {
        const pkg = JSON.parse(this.preparedFiles['package.json']);
        if (pkg.dependencies?.astro || pkg.devDependencies?.astro) {
          startArgs = ['run', 'preview', '--', '--port', String(port), '--host', '0.0.0.0'];
        } else if (pkg.dependencies?.vite || pkg.devDependencies?.vite) {
          startArgs = ['run', 'preview', '--', '--port', String(port), '--host', '0.0.0.0'];
        }
      } catch {}
    }

    const cmd = await this.sandboxInstance.runCommand({
      command: startCmd,
      args: startArgs,
      detached: true,
    });

    let hostUrl: string;
    try {
      hostUrl = this.sandboxInstance.domain(port);
    } catch {
      hostUrl = `http://127.0.0.1:${port}`;
    }

    // Polling for server readiness
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(hostUrl, { signal: AbortSignal.timeout(2000) });
        if (res.status >= 200 && res.status < 500) {
          break;
        }
      } catch {
        await new Promise((r) => setTimeout(r, 600));
      }
    }

    return {
      url: hostUrl,
      stop: async () => {
        try {
          if (cmd && typeof (cmd as any).stop === 'function') {
            await (cmd as any).stop();
          }
          await this.sandboxInstance.runCommand('pkill', ['-f', 'node']);
        } catch {}
      },
    };
  }

  async smokeTest(url: string, timeoutMs = 10_000): Promise<SmokeTestResult> {
    const startTime = Date.now();
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      const text = await res.text();
      return {
        success: res.status >= 200 && res.status < 400,
        statusCode: res.status,
        responseBodySnippet: text.slice(0, 300),
        durationMs: Date.now() - startTime,
      };
    } catch (err: any) {
      return {
        success: false,
        durationMs: Date.now() - startTime,
        error: err.message,
      };
    }
  }

  async cleanup(): Promise<void> {
    if (this.sandboxInstance) {
      try {
        await this.sandboxInstance.stop();
      } catch {}
      this.sandboxInstance = null;
    }
  }
}

export function getBuildRunner(): BuildRunner {
  if (process.env.VERCEL_TOKEN && (process.env.VERCEL_PROJECT_ID || process.env.VERCEL_TEAM_ID)) {
    return new VercelSandboxRunner();
  }
  if (process.env.NODE_ENV !== 'production') {
    return new LocalBuildRunner();
  }
  throw new Error('No supported build runner available in production environment without Vercel Sandbox credentials.');
}

export interface RealRuntimeEvidence {
  evidenceId: string;
  projectId: string;
  revision: number;
  candidateHash: string;
  framework: string;
  command: string;
  exitStatus: number;
  stdoutSummary: string;
  stderrSummary: string;
  startupStatus: 'ready' | 'failed' | 'timeout';
  url: string;
  port: number;
  httpStatus: number;
  healthy: boolean;
  timestamp: string;
  durationMs: number;
  processTerminated: boolean;
  sandboxCleaned: boolean;
}

export async function executeRealRuntimeVerification(params: {
  files: Record<string, string>;
  framework: string;
  projectId: string;
  revision: number;
  candidateHash: string;
  port?: number;
  runner?: BuildRunner;
}): Promise<RealRuntimeEvidence> {
  const {
    files,
    framework,
    projectId,
    revision,
    candidateHash,
    port = 3001,
  } = params;

  const startTime = Date.now();
  const evidenceId = 'ev_rt_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8);
  const timestamp = new Date().toISOString();

  let runner: BuildRunner;
  try {
    runner = params.runner || getBuildRunner();
  } catch (err: any) {
    return {
      evidenceId,
      projectId,
      revision,
      candidateHash,
      framework,
      command: 'none',
      exitStatus: 1,
      stdoutSummary: '',
      stderrSummary: err?.message || 'Runner unavailable',
      startupStatus: 'failed',
      url: '',
      port,
      httpStatus: 503,
      healthy: false,
      timestamp,
      durationMs: Date.now() - startTime,
      processTerminated: true,
      sandboxCleaned: true,
    };
  }

  let processTerminated = false;
  let sandboxCleaned = false;

  try {
    // 1. prepare project
    await runner.prepare(files);

    // 2. install dependencies
    const installRes = await runner.install(90_000);
    if (!installRes.success) {
      return {
        evidenceId,
        projectId,
        revision,
        candidateHash,
        framework,
        command: installRes.command || 'install',
        exitStatus: installRes.exitCode,
        stdoutSummary: (installRes.stdout || '').slice(-300),
        stderrSummary: (installRes.stderr || '').slice(-300),
        startupStatus: 'failed',
        url: '',
        port,
        httpStatus: 500,
        healthy: false,
        timestamp,
        durationMs: Date.now() - startTime,
        processTerminated: true,
        sandboxCleaned: false,
      };
    }

    // 3. execute native build
    const buildRes = await runner.build(90_000);
    if (!buildRes.success) {
      return {
        evidenceId,
        projectId,
        revision,
        candidateHash,
        framework,
        command: buildRes.command || 'build',
        exitStatus: buildRes.exitCode,
        stdoutSummary: (buildRes.stdout || '').slice(-300),
        stderrSummary: (buildRes.stderr || '').slice(-300),
        startupStatus: 'failed',
        url: '',
        port,
        httpStatus: 500,
        healthy: false,
        timestamp,
        durationMs: Date.now() - startTime,
        processTerminated: true,
        sandboxCleaned: false,
      };
    }

    // 4. start the generated application using real start command
    const runningServer = await runner.start(port, 25_000);

    // 5 & 6. HTTP smoke verification
    const smokeRes = await runner.smokeTest(runningServer.url, 10_000);

    // 8. terminate process
    await runningServer.stop();
    processTerminated = true;

    // 9. cleanup sandbox
    await runner.cleanup();
    sandboxCleaned = true;

    return {
      evidenceId,
      projectId,
      revision,
      candidateHash,
      framework,
      command: `${framework} production start`,
      exitStatus: smokeRes.success ? 0 : 1,
      stdoutSummary: (buildRes.stdout || '').slice(-200),
      stderrSummary: smokeRes.error || '',
      startupStatus: smokeRes.success ? 'ready' : 'failed',
      url: runningServer.url,
      port,
      httpStatus: smokeRes.statusCode || (smokeRes.success ? 200 : 500),
      healthy: smokeRes.success,
      timestamp,
      durationMs: Date.now() - startTime,
      processTerminated,
      sandboxCleaned,
    };
  } catch (err: any) {
    try {
      await runner.cleanup();
      sandboxCleaned = true;
    } catch {}

    return {
      evidenceId,
      projectId,
      revision,
      candidateHash,
      framework,
      command: `${framework} runtime execution`,
      exitStatus: 1,
      stdoutSummary: '',
      stderrSummary: err?.message || 'Runtime execution threw error',
      startupStatus: 'failed',
      url: '',
      port,
      httpStatus: 500,
      healthy: false,
      timestamp,
      durationMs: Date.now() - startTime,
      processTerminated,
      sandboxCleaned,
    };
  }
}

export function validateRuntimeEvidenceIntegrity(
  evidence: RealRuntimeEvidence,
  expected: { candidateHash: string; projectId: string; revision: number; framework: string }
): { valid: boolean; error?: string } {
  if (!evidence) {
    return { valid: false, error: 'Runtime evidence is missing' };
  }
  if (!evidence.evidenceId || !evidence.evidenceId.startsWith('ev_rt_')) {
    return { valid: false, error: 'Invalid or forged runtime evidence identifier' };
  }
  if (!evidence.healthy || evidence.httpStatus < 200 || evidence.httpStatus >= 400) {
    return { valid: false, error: `Runtime HTTP smoke check failed (status: ${evidence.httpStatus})` };
  }
  if (evidence.candidateHash !== expected.candidateHash) {
    return { valid: false, error: `Candidate hash mismatch on runtime evidence (expected '${expected.candidateHash}', got '${evidence.candidateHash}')` };
  }
  if (evidence.projectId !== expected.projectId) {
    return { valid: false, error: `Project ID mismatch on runtime evidence (expected '${expected.projectId}', got '${evidence.projectId}')` };
  }
  if (evidence.revision !== expected.revision) {
    return { valid: false, error: `Revision mismatch on runtime evidence (expected ${expected.revision}, got ${evidence.revision})` };
  }
  if (evidence.framework.toLowerCase() !== expected.framework.toLowerCase()) {
    return { valid: false, error: `Framework mismatch on runtime evidence (expected '${expected.framework}', got '${evidence.framework}')` };
  }
  const age = Date.now() - new Date(evidence.timestamp).getTime();
  if (isNaN(age) || age > 15 * 60 * 1000) {
    return { valid: false, error: 'Runtime evidence expired (>15 minutes old)' };
  }
  return { valid: true };
}
