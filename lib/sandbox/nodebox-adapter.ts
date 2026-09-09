import { Nodebox, ShellProcess } from '@codesandbox/nodebox';

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

  /**
   * Mount all project files into virtual filesystem in one fast batch
   */
  async mountFiles(files: FileSystem): Promise<void> {
    if (!this.nodebox) throw new Error('Nodebox not initialized');

    this.log(`📁 Mounting ${Object.keys(files).length} files to virtual filesystem...`);

    const normalized: Record<string, string> = {};
    for (const [path, content] of Object.entries(files)) {
      const cleanPath = path.replace(/^\/+/, '');
      normalized[cleanPath] = content;
    }

    try {
      await this.nodebox.fs.init(normalized);
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
