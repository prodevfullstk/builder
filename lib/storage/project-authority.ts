/**
 * Project Authority & Ownership Layer
 *
 * Defines the single authoritative project model and enforces project ownership:
 * Authoritative project identity (owner_id + project.id)
 *         ↓
 * Project workspace
 *         ↓
 * Candidate file changes
 *         ↓
 * Validation
 *         ↓
 * Commit
 *         ↓
 * Persistence / runtime / export
 */

import { Framework, ChatMessage } from '@/lib/store/project-store';

export interface AuthoritativeProject {
  id: string;
  owner_id: string;
  name: string;
  framework: Framework;
  dbProvider?: string;
  authProvider?: string;
  files: Record<string, string>;
  messages: ChatMessage[];
  activeFile?: string;
  createdAt: number;
  updatedAt: number;
}

export interface OwnershipVerificationResult {
  authorized: boolean;
  project?: AuthoritativeProject;
  error?: string;
  status: number;
}

// In-memory authority store for active server session / local fallback
const serverProjectRegistry: Map<string, AuthoritativeProject> = new Map();

/**
 * Register or update a project in the server authority registry
 */
export function registerServerProject(project: AuthoritativeProject): void {
  if (!project.id) {
    throw new Error('Project ID is required.');
  }
  if (!project.owner_id) {
    throw new Error('Project owner_id is required.');
  }
  serverProjectRegistry.set(project.id, {
    ...project,
    updatedAt: Date.now(),
  });
}

/**
 * Get project by ID from the server authority registry
 */
export function getServerProject(projectId: string): AuthoritativeProject | null {
  if (!projectId) return null;
  return serverProjectRegistry.get(projectId) || null;
}

/**
 * List all projects owned by a specific user
 */
export function listServerProjectsForOwner(ownerId: string): AuthoritativeProject[] {
  if (!ownerId) return [];
  const list: AuthoritativeProject[] = [];
  for (const proj of serverProjectRegistry.values()) {
    if (proj.owner_id === ownerId) {
      list.push(proj);
    }
  }
  return list.sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Strictly verify that the requesting authenticated user owns the target project.
 *
 * Requirements:
 * - Missing projectId returns 400 Bad Request (never select arbitrary or "first project").
 * - Non-existent project returns 404 Not Found.
 * - Access by another user returns 403 Forbidden.
 */
export async function verifyProjectOwnership(
  projectId: string | null | undefined,
  authenticatedUserId: string
): Promise<OwnershipVerificationResult> {
  // 1. Missing project ID validation
  if (!projectId || typeof projectId !== 'string' || !projectId.trim()) {
    return {
      authorized: false,
      error: 'Validation Error: projectId is required. Implicit or default project selection is forbidden.',
      status: 400,
    };
  }

  const cleanId = projectId.trim();

  // 2. Lookup project
  const project = getServerProject(cleanId);
  if (!project) {
    return {
      authorized: false,
      error: `Project not found with ID '${cleanId}'.`,
      status: 404,
    };
  }

  // 3. Ownership verification
  if (project.owner_id !== authenticatedUserId) {
    return {
      authorized: false,
      error: 'Forbidden: You do not have permission to access or modify this project.',
      status: 403,
    };
  }

  return {
    authorized: true,
    project,
    status: 200,
  };
}

/**
 * Seed a project into the authority registry (used for tests or initial user workspaces)
 */
export function seedAuthoritativeProject(
  id: string,
  ownerId: string,
  name: string = 'Untitled Project',
  framework: Framework = 'nextjs',
  files: Record<string, string> = {}
): AuthoritativeProject {
  const proj: AuthoritativeProject = {
    id,
    owner_id: ownerId,
    name,
    framework,
    files,
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  registerServerProject(proj);
  return proj;
}
