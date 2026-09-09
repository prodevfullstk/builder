import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Service Worker API Route for Nodebox
 * 
 * CRITICAL: Nodebox requires its service worker to be served from your own origin.
 * Browsers won't register service workers from node_modules due to security policy.
 * 
 * This endpoint serves the Nodebox service worker with proper headers:
 * - Content-Type: application/javascript
 * - Service-Worker-Allowed: / (allows SW to control the entire origin)
 * - Cache-Control: no-cache (ensures fresh SW on updates)
 */
export async function GET() {
  try {
    // Read service worker from @codesandbox/nodebox package
    const swPath = join(
      process.cwd(),
      'node_modules',
      '@codesandbox',
      'nodebox',
      'dist',
      '__sw__.js'
    );
    
    const swContent = readFileSync(swPath, 'utf-8');
    
    return new Response(swContent, {
      status: 200,
      headers: {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Service-Worker-Allowed': '/',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  } catch (error) {
    console.error('Failed to serve service worker:', error);
    return new Response('Service Worker not found', { status: 404 });
  }
}
