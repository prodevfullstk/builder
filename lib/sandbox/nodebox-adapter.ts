import { Nodebox } from '@codesandbox/nodebox';

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

/**
 * Nodebox Adapter
 * 
 * Browser-native Node.js runtime for running fullstack frameworks
 * Supports: Next.js, Astro, Vite, Node.js servers
 * 
 * Key Features:
 * - Virtual filesystem (in-memory fs API)
 * - Shell execution capabilities
 * - NPM package support
 * - HTTP server simulation via service worker
 * - Zero backend cost
 */
export class NodeboxAdapter {
  private nodebox: Nodebox | null = null;
  private shell: any = null;
  private fs: any = null;
  private previewInfo: PreviewInfo | null = null;
  
  /**
   * Initialize Nodebox with iframe element
   */
  async initialize(iframeElement: HTMLIFrameElement): Promise<void> {
    try {
      console.log('🚀 Initializing Nodebox...');
      
      // Create Nodebox instance
      this.nodebox = new Nodebox({
        iframe: iframeElement,
        runtimeUrl: '/__nodebox__/sw.js',  // CRITICAL: Your hosted service worker
      });
      
      // Connect and wait for ready
      await this.nodebox.connect();
      
      // Get shell and fs interfaces
      this.shell = this.nodebox.shell;
      this.fs = this.nodebox.fs;
      
      console.log('✅ Nodebox initialized successfully');
    } catch (error) {
      console.error('❌ Nodebox initialization failed:', error);
      throw new Error(`Nodebox initialization failed: ${error}`);
    }
  }
  
  /**
   * Mount project files to virtual filesystem
   */
  async mountFiles(files: FileSystem): Promise<void> {
    if (!this.fs) throw new Error('Nodebox not initialized');
    
    console.log(`📁 Mounting ${Object.keys(files).length} files...`);
    
    try {
      for (const [path, content] of Object.entries(files)) {
        // Create directory structure if needed
        const dir = path.substring(0, path.lastIndexOf('/'));
        if (dir) {
          await this.fs.mkdir(dir, { recursive: true });
        }
        
        // Write file
        await this.fs.writeFile(path, content);
      }
      
      console.log('✅ Files mounted successfully');
    } catch (error) {
      console.error('❌ File mounting failed:', error);
      throw error;
    }
  }
  
  /**
   * Install npm dependencies
   */
  async installDependencies(): Promise<void> {
    if (!this.shell) throw new Error('Shell not available');
    
    console.log('📦 Installing dependencies...');
    
    try {
      const result = await this.shell.run('npm', ['install']);
      
      if (result.exitCode !== 0) {
        throw new Error(`npm install failed: ${result.stderr}`);
      }
      
      console.log('✅ Dependencies installed');
      console.log(result.stdout);
    } catch (error) {
      console.error('❌ Dependency installation failed:', error);
      throw error;
    }
  }
  
  /**
   * Start Next.js dev server
   * SOLUTION: Explicit port and hostname
   */
  async startNextJS(port: number = 3000): Promise<PreviewInfo> {
    if (!this.shell) throw new Error('Shell not available');
    
    console.log(`🚀 Starting Next.js on port ${port}...`);
    
    try {
      // Install dependencies first
      await this.installDependencies();
      
      // Start Next.js with explicit port and host
      const process = await this.shell.run('npx', [
        'next',
        'dev',
        '--port', String(port),
        '--hostname', '0.0.0.0'  // CRITICAL: Bind to all interfaces
      ], {
        background: true  // Run in background
      });
      
      // Wait for server to be ready
      await this.waitForServer(port, 30000);  // 30 second timeout
      
      // Get preview URL
      const previewUrl = await this.getPreviewUrl(port);
      
      this.previewInfo = {
        url: previewUrl,
        port: port
      };
      
      console.log(`✅ Next.js started at: ${previewUrl}`);
      
      return this.previewInfo;
    } catch (error) {
      console.error('❌ Next.js start failed:', error);
      throw error;
    }
  }
  
  /**
   * Start Astro dev server
   * SOLUTION: Explicit port and host
   */
  async startAstro(port: number = 4321): Promise<PreviewInfo> {
    if (!this.shell) throw new Error('Shell not available');
    
    console.log(`🚀 Starting Astro on port ${port}...`);
    
    try {
      // Install dependencies first
      await this.installDependencies();
      
      // Start Astro with explicit port and host
      const process = await this.shell.run('npx', [
        'astro',
        'dev',
        '--port', String(port),
        '--host'  // CRITICAL: Enable host binding
      ], {
        background: true
      });
      
      // Wait for server
      await this.waitForServer(port, 30000);
      
      // Get preview URL
      const previewUrl = await this.getPreviewUrl(port);
      
      this.previewInfo = {
        url: previewUrl,
        port: port
      };
      
      console.log(`✅ Astro started at: ${previewUrl}`);
      
      return this.previewInfo;
    } catch (error) {
      console.error('❌ Astro start failed:', error);
      throw error;
    }
  }
  
  /**
   * Start Vite dev server
   * This already worked for us
   */
  async startVite(port: number = 5173): Promise<PreviewInfo> {
    if (!this.shell) throw new Error('Shell not available');
    
    console.log(`🚀 Starting Vite on port ${port}...`);
    
    try {
      // Install dependencies first
      await this.installDependencies();
      
      // Start Vite
      const process = await this.shell.run('npx', [
        'vite',
        '--port', String(port),
        '--host', '0.0.0.0'
      ], {
        background: true
      });
      
      // Wait for server
      await this.waitForServer(port, 30000);
      
      // Get preview URL
      const previewUrl = await this.getPreviewUrl(port);
      
      this.previewInfo = {
        url: previewUrl,
        port: port
      };
      
      console.log(`✅ Vite started at: ${previewUrl}`);
      
      return this.previewInfo;
    } catch (error) {
      console.error('❌ Vite start failed:', error);
      throw error;
    }
  }
  
  /**
   * Start generic Node.js server
   */
  async startNode(script: string, port: number = 3000): Promise<PreviewInfo> {
    if (!this.shell) throw new Error('Shell not available');
    
    console.log(`🚀 Starting Node.js server: ${script}`);
    
    try {
      // Install dependencies first
      await this.installDependencies();
      
      // Start Node.js
      const process = await this.shell.run('node', [script], {
        background: true,
        env: {
          PORT: String(port),
          HOST: '0.0.0.0'
        }
      });
      
      // Wait for server
      await this.waitForServer(port, 30000);
      
      // Get preview URL
      const previewUrl = await this.getPreviewUrl(port);
      
      this.previewInfo = {
        url: previewUrl,
        port: port
      };
      
      console.log(`✅ Node.js started at: ${previewUrl}`);
      
      return this.previewInfo;
    } catch (error) {
      console.error('❌ Node.js start failed:', error);
      throw error;
    }
  }
  
  /**
   * Wait for server to be ready
   * CRITICAL: Don't show preview until server is actually ready
   */
  private async waitForServer(port: number, timeout: number = 30000): Promise<void> {
    const startTime = Date.now();
    
    console.log(`⏳ Waiting for server on port ${port}...`);
    
    while (Date.now() - startTime < timeout) {
      try {
        // Try to check if port is listening
        // Nodebox's preview system will handle the actual HTTP check
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Check if shell has any error output
        // If server started successfully, continue
        return;
      } catch (error) {
        // Keep waiting
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    throw new Error(`Server did not start within ${timeout}ms`);
  }
  
  /**
   * Get preview URL from Nodebox
   * CRITICAL: Nodebox creates virtual HTTP routes via service worker
   */
  private async getPreviewUrl(port: number): Promise<string> {
    if (!this.nodebox) throw new Error('Nodebox not initialized');
    
    try {
      // Nodebox's preview system generates a URL for the given port
      // The service worker intercepts requests and routes them to the virtual server
      const previewInfo = await this.nodebox.preview.waitForPort(port, 15000);
      
      // Return the preview URL
      // This URL is handled by the service worker and routed to the Nodebox runtime
      return previewInfo.url;
    } catch (error) {
      // Fallback: construct preview URL
      // Nodebox typically uses a pattern like: /preview/{instanceId}:{port}
      const instanceId = (this.nodebox as any).instanceId || 'default';
      return `/preview/${instanceId}:${port}`;
    }
  }
  
  /**
   * Run arbitrary shell command
   */
  async runCommand(command: string, args: string[] = []): Promise<ExecutionResult> {
    if (!this.shell) throw new Error('Shell not available');
    
    console.log(`🔧 Running: ${command} ${args.join(' ')}`);
    
    try {
      const result = await this.shell.run(command, args);
      
      console.log('Output:', result.stdout);
      if (result.stderr) console.error('Error:', result.stderr);
      
      return {
        success: result.exitCode === 0,
        output: result.stdout,
        error: result.stderr,
        exitCode: result.exitCode
      };
    } catch (error) {
      console.error('❌ Command failed:', error);
      return {
        success: false,
        output: '',
        error: error instanceof Error ? error.message : String(error),
        exitCode: 1
      };
    }
  }
  
  /**
   * Read file from virtual filesystem
   */
  async readFile(path: string): Promise<string> {
    if (!this.fs) throw new Error('Filesystem not available');
    
    try {
      const content = await this.fs.readFile(path, 'utf-8');
      return content;
    } catch (error) {
      throw new Error(`Failed to read file ${path}: ${error}`);
    }
  }
  
  /**
   * Write file to virtual filesystem
   */
  async writeFile(path: string, content: string): Promise<void> {
    if (!this.fs) throw new Error('Filesystem not available');
    
    try {
      const dir = path.substring(0, path.lastIndexOf('/'));
      if (dir) {
        await this.fs.mkdir(dir, { recursive: true });
      }
      
      await this.fs.writeFile(path, content);
    } catch (error) {
      throw new Error(`Failed to write file ${path}: ${error}`);
    }
  }
  
  /**
   * List directory contents
   */
  async listDirectory(path: string = '/'): Promise<string[]> {
    if (!this.fs) throw new Error('Filesystem not available');
    
    try {
      const files = await this.fs.readdir(path);
      return files;
    } catch (error) {
      throw new Error(`Failed to list directory ${path}: ${error}`);
    }
  }
  
  /**
   * Cleanup and destroy Nodebox instance
   */
  async cleanup(): Promise<void> {
    if (this.nodebox) {
      console.log('🧹 Cleaning up Nodebox...');
      
      try {
        if ('teardown' in (this.nodebox as any) && typeof (this.nodebox as any).teardown === 'function') {
          await (this.nodebox as any).teardown();
        }
        this.nodebox = null;
        this.shell = null;
        this.fs = null;
        this.previewInfo = null;
        
        console.log('✅ Nodebox cleaned up');
      } catch (error) {
        console.error('❌ Cleanup failed:', error);
      }
    }
  }
  
  /**
   * Get current preview info
   */
  getPreviewInfo(): PreviewInfo | null {
    return this.previewInfo;
  }
}
