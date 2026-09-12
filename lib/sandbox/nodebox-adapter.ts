import { Nodebox, ShellProcess } from '@codesandbox/nodebox';
import { detectBackendEntry as detectBackendEntryUtil } from './detect-backend';

export interface FileSystem {
  [path: string]: string;
}

export interface PreviewInfo {
  url: string;
  port: number;
}

export interface ExecutionResult {
  success: boolean;
  output: string;
  error: string;
  exitCode: number;
}

export type Framework = 'nextjs' | 'astro' | 'vite' | 'node';

export interface DependencyMutationRecord {
  dependency: string;
  sourceVersion: string;
  runtimeVersion: string;
  reason: string;
}

export interface DependencyNormalizationReport {
  wasNormalized: boolean;
  mutations: DependencyMutationRecord[];
  effectiveEnvironment: 'declared' | 'runtime_normalized';
}

function getBridgeIframe(): HTMLIFrameElement {
  let bridgeIframe = document.getElementById('nodebox-runtime-bridge') as HTMLIFrameElement;
  if (!bridgeIframe) {
    bridgeIframe = document.createElement('iframe');
    bridgeIframe.id = 'nodebox-runtime-bridge';
    bridgeIframe.style.position = 'fixed';
    bridgeIframe.style.top = '-9999px';
    bridgeIframe.style.left = '-9999px';
    bridgeIframe.style.width = '1px';
    bridgeIframe.style.height = '1px';
    bridgeIframe.style.opacity = '0';
    bridgeIframe.style.pointerEvents = 'none';
    bridgeIframe.setAttribute('aria-hidden', 'true');
    document.body.appendChild(bridgeIframe);
  }
  return bridgeIframe;
}

/**
 * Nodebox Adapter
 * Browser-native runtime for running frameworks via CodeSandbox Nodebox
 */
export class NodeboxAdapter {
  private nodebox: Nodebox | null = null;
  private currentProcess: ShellProcess | null = null;
  private previewInfo: PreviewInfo | null = null;
  private onLogCallback?: (log: string) => void;

  setLogCallback(cb: (log: string) => void) {
    this.onLogCallback = cb;
  }

  private log(message: string) {
    console.log(message);
    this.onLogCallback?.(message);
  }

  /**
   * Initialize Nodebox using the dedicated hidden bridge iframe
   */
  async initialize(customIframe?: HTMLIFrameElement): Promise<void> {
    try {
      this.log('🚀 Initializing Nodebox runtime...');
      const bridgeIframe = customIframe || getBridgeIframe();

      // Connect without local custom runtimeUrl to use official CodeSandbox CDN
      this.nodebox = new Nodebox({
        iframe: bridgeIframe,
      });

      await this.nodebox.connect();
      this.log('✅ Nodebox connected successfully');
    } catch (error: any) {
      this.log(`❌ Nodebox initialization failed: ${error?.message || error}`);
      throw error;
    }
  }

  private lastNormalizationReport: DependencyNormalizationReport = {
    wasNormalized: false,
    mutations: [],
    effectiveEnvironment: 'declared',
  };

  getNormalizationReport(): DependencyNormalizationReport {
    return this.lastNormalizationReport;
  }

  /**
   * Mount all project files into virtual filesystem in one fast batch.
   * Does NOT mutate the source project files. If sandbox runtime normalization is required,
   * it is explicitly recorded in a normalization report and logged.
   */
  async mountFiles(files: FileSystem): Promise<void> {
    if (!this.nodebox) throw new Error('Nodebox not initialized');

    this.log(`📁 Mounting ${Object.keys(files).length} files to virtual filesystem...`);

    const runtimeFiles: Record<string, string> = {};
    for (const [path, content] of Object.entries(files)) {
      const cleanPath = path.replace(/^\/+/, '');
      runtimeFiles[cleanPath] = content;
    }

    const mutations: DependencyMutationRecord[] = [];

    // Explicit dependency normalization for browser WASM compatibility
    if (runtimeFiles['package.json']) {
      try {
        const pkg = JSON.parse(runtimeFiles['package.json']);
        if (!pkg.dependencies) pkg.dependencies = {};

        const STABLE_MAP: Record<string, string> = {
          'lucide-react': '^0.344.0',
          '@supabase/supabase-js': '^2.39.8',
          'canvas-confetti': '^1.9.2',
          'framer-motion': '^11.3.31',
          'clsx': '^2.1.0',
          'tailwind-merge': '^2.2.1',
          'zustand': '^4.5.2',
        };

        for (const [dep, ver] of Object.entries(pkg.dependencies)) {
          const verStr = String(ver);
          if (verStr.includes('canary') || verStr.includes('beta') || verStr === 'latest' || verStr === '*') {
            const replacement = STABLE_MAP[dep] || '^1.0.0';
            mutations.push({
              dependency: dep,
              sourceVersion: verStr,
              runtimeVersion: replacement,
              reason: 'Replaced unstable/floating version for in-browser sandbox resolution',
            });
            pkg.dependencies[dep] = replacement;
          } else if (dep === 'lucide-react' && verStr !== '^0.344.0') {
            mutations.push({
              dependency: dep,
              sourceVersion: verStr,
              runtimeVersion: '^0.344.0',
              reason: 'Pinned for in-browser Nodebox Sandpack bundler compatibility',
            });
            pkg.dependencies[dep] = '^0.344.0';
          }
        }

        if (mutations.length > 0) {
          runtimeFiles['package.json'] = JSON.stringify(pkg, null, 2);
          this.log(`⚠️ [Runtime Normalization] ${mutations.length} package dependency pin(s) adjusted for in-browser sandbox (source project remains unmodified).`);
        }
      } catch (err) {
        this.log('[Runtime Normalization] Warning: Failed to parse package.json for runtime validation.');
      }
    } else {
      // Declared package.json missing from source project
      mutations.push({
        dependency: 'all',
        sourceVersion: 'none',
        runtimeVersion: 'default_runtime_manifest',
        reason: 'Source project missing declared package.json; provided runtime execution manifest',
      });
      runtimeFiles['package.json'] = JSON.stringify({
        name: 'opendork-project',
        private: true,
        version: '0.0.0',
        dependencies: {
          'react': '^18.2.0',
          'react-dom': '^18.2.0',
          'lucide-react': '^0.344.0',
          'clsx': '^2.1.0',
          'tailwind-merge': '^2.2.1',
          '@supabase/supabase-js': '^2.39.8',
        },
      }, null, 2);
      this.log('⚠️ [Runtime Normalization] Generated default runtime package.json because source project lacked a package manifest.');
    }

    this.lastNormalizationReport = {
      wasNormalized: mutations.length > 0,
      mutations,
      effectiveEnvironment: mutations.length > 0 ? 'runtime_normalized' : 'declared',
    };

    try {
      await this.nodebox.fs.init(runtimeFiles);
      this.log('✅ Files mounted successfully');
    } catch (error: any) {
      this.log(`❌ File mounting failed: ${error?.message || error}`);
      throw error;
    }
  }

  /**
   * Start dev server for the selected framework
   */
  async startFramework(framework: Framework, port?: number, entry?: string): Promise<PreviewInfo> {
    if (!this.nodebox) throw new Error('Nodebox not initialized');

    const targetPort = port || (framework === 'vite' ? 5173 : framework === 'astro' ? 4321 : 3000);
    this.log(`🚀 Starting ${framework.toUpperCase()} dev server on port ${targetPort}...`);

    // Kill previous process if still active
    if (this.currentProcess) {
      try {
        await this.currentProcess.kill();
      } catch {}
      this.currentProcess = null;
    }

    const proc = this.nodebox.shell.create();
    this.currentProcess = proc;

    // Stream logs
    proc.stdout.on('data', (data) => this.log(`[${framework}] ${data}`));
    proc.stderr.on('data', (data) => this.log(`[${framework} err] ${data}`));

    let shellInfo;
    switch (framework) {
      case 'nextjs':
        shellInfo = await proc.runCommand('npx', [
          'next',
          'dev',
          '--port',
          String(targetPort),
          '--hostname',
          '0.0.0.0',
        ]);
        break;

      case 'vite':
        shellInfo = await proc.runCommand('npx', [
          'vite',
          '--port',
          String(targetPort),
          '--host',
          '0.0.0.0',
        ]);
        break;

      case 'astro':
        shellInfo = await proc.runCommand('npx', [
          'astro',
          'dev',
          '--port',
          String(targetPort),
          '--host',
        ]);
        break;

      case 'node':
        shellInfo = await proc.runCommand('node', [entry || 'index.js']);
        break;

      default:
        throw new Error(`Unsupported framework: ${framework}`);
    }

    // Resolve preview URL
    try {
      if (shellInfo?.id) {
        const preview = await this.nodebox.preview.getByShellId(shellInfo.id, 25000);
        if (preview?.url) {
          this.previewInfo = { url: preview.url, port: targetPort };
          this.log(`✅ ${framework} live at: ${preview.url}`);
          return this.previewInfo;
        }
      }
    } catch {
      // Fallback: wait for listening port
    }

    const portInfo = await this.nodebox.preview.waitForPort(targetPort, 20000);
    this.previewInfo = { url: portInfo.url, port: targetPort };
    this.log(`✅ ${framework} live at: ${portInfo.url}`);
    return this.previewInfo;
  }

  async startNextJS(port: number = 3000): Promise<PreviewInfo> {
    return this.startFramework('nextjs', port);
  }

  async startVite(port: number = 5173): Promise<PreviewInfo> {
    return this.startFramework('vite', port);
  }

  async startAstro(port: number = 4321): Promise<PreviewInfo> {
    return this.startFramework('astro', port);
  }

  async startNode(entry: string = 'index.js', port: number = 3000): Promise<PreviewInfo> {
    return this.startFramework('node', port, entry);
  }

  /**
   * Detect if the project contains a Node backend server file.
   * Delegates to standalone utility to avoid importing browser-only deps during SSR.
   */
  static detectBackendEntry(files: Record<string, string>): string | null {
    return detectBackendEntryUtil(files);
  }

  /**
   * Start lightweight Node.js backend server directly without heavy bundling
   * Boots in < 500ms and uses < 10MB of WASM memory
   */
  async startBackendServer(files: FileSystem, port: number = 3000): Promise<PreviewInfo> {
    if (!this.nodebox) throw new Error('Nodebox not initialized');

    const entry = NodeboxAdapter.detectBackendEntry(files) || 'server.js';
    this.log(`🚀 Starting lightweight Node.js backend server (${entry}) on port ${port}...`);

    await this.mountFiles(files);

    if (this.currentProcess) {
      try {
        await this.currentProcess.kill();
      } catch {}
      this.currentProcess = null;
    }

    const proc = this.nodebox.shell.create();
    this.currentProcess = proc;

    proc.stdout.on('data', (data) => this.log(`[Backend API] ${data}`));
    proc.stderr.on('data', (data) => this.log(`[Backend API err] ${data}`));

    const shellInfo = await proc.runCommand('node', [entry]);

    try {
      if (shellInfo?.id) {
        const preview = await this.nodebox.preview.getByShellId(shellInfo.id, 15000);
        if (preview?.url) {
          this.previewInfo = { url: preview.url, port };
          this.log(`✅ Backend API live at: ${preview.url}`);
          return this.previewInfo;
        }
      }
    } catch {
      // Fallback: wait for port
    }

    const portInfo = await this.nodebox.preview.waitForPort(port, 15000);
    this.previewInfo = { url: portInfo.url, port };
    this.log(`✅ Backend API live at: ${portInfo.url}`);
    return this.previewInfo;
  }

  async cleanup(): Promise<void> {
    if (this.currentProcess) {
      try {
        await this.currentProcess.kill();
      } catch {}
      this.currentProcess = null;
    }
  }

  getPreviewInfo(): PreviewInfo | null {
    return this.previewInfo;
  }
}
