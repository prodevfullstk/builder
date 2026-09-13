import path from 'node:path';

/**
 * Canonical Relative Sandbox Workspace Containment (SEC-401)
 * Enforces that every uploaded file path strictly resolves within rootDir (/vercel/app).
 * Strictly rejects null bytes, Windows drive letters, UNC paths, and directory traversal.
 */
export function assertContainedSandboxPath(rawPath: string, rootDir = '/vercel/app'): string {
  if (!rawPath || typeof rawPath !== 'string' || rawPath.includes('\0')) {
    throw new Error(`Security Violation: Invalid or null-byte path '${rawPath}'`);
  }

  // Reject Windows drive letters (C:) and UNC shares (\\)
  if (/^[a-zA-Z]:/.test(rawPath) || rawPath.startsWith('\\\\') || rawPath.startsWith('//')) {
    throw new Error(`Security Violation: Absolute host path prohibited: '${rawPath}'`);
  }

  // Normalize separators to POSIX
  const normalized = rawPath
    .replace(/\\+/g, '/')
    .replace(/^\/+/, '');

  const target = path.posix.resolve(rootDir, normalized);
  const relative = path.posix.relative(rootDir, target);

  if (
    relative === '..' ||
    relative.startsWith('../') ||
    path.posix.isAbsolute(relative) ||
    target === rootDir
  ) {
    throw new Error(`Security Violation: Path traversal outside sandbox workspace detected: '${rawPath}'`);
  }

  return target;
}
