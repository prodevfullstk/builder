/**
 * Project Storage & Persistence Layer
 * Provides local-first persistent storage for user projects, auto-save, and project switching.
 */

import { ChatMessage, Framework, ProjectState } from "@/lib/store/project-store";

export interface SavedProject {
  id: string;
  name: string;
  framework: Framework;
  dbProvider: ProjectState['dbProvider'];
  authProvider: ProjectState['authProvider'];
  files: Record<string, string>;
  messages: ChatMessage[];
  activeFile?: string;
  createdAt: number;
  updatedAt: number;
}

export interface SavedProjectSummary {
  id: string;
  name: string;
  framework: Framework;
  fileCount: number;
  updatedAt: number;
  createdAt: number;
}

const STORAGE_KEY_PREFIX = "opendork_project_";
const PROJECTS_INDEX_KEY = "opendork_projects_index";

/**
 * Generate a clean, unique project ID
 */
export function generateProjectId(): string {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 7);
  return `proj_${timestamp}_${randomPart}`;
}

/**
 * Get the list of all project IDs and summaries
 */
export function listSavedProjects(): SavedProjectSummary[] {
  if (typeof window === "undefined") return [];

  try {
    const indexRaw = localStorage.getItem(PROJECTS_INDEX_KEY);
    if (!indexRaw) return [];
    const index: string[] = JSON.parse(indexRaw);

    const summaries: SavedProjectSummary[] = [];

    for (const id of index) {
      try {
        const raw = localStorage.getItem(STORAGE_KEY_PREFIX + id);
        if (raw) {
          const parsed: SavedProject = JSON.parse(raw);
          summaries.push({
            id: parsed.id,
            name: parsed.name || "Untitled Project",
            framework: parsed.framework || "nextjs",
            fileCount: Object.keys(parsed.files || {}).length,
            updatedAt: parsed.updatedAt || parsed.createdAt || Date.now(),
            createdAt: parsed.createdAt || Date.now(),
          });
        }
      } catch {
        // Skip corrupted entry
      }
    }

    // Sort newest first
    return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch (err) {
    console.error("[ProjectStorage] Error listing projects:", err);
    return [];
  }
}

/**
 * Save or update a project in storage
 */
export function saveProjectToStorage(project: SavedProject): void {
  if (typeof window === "undefined" || !project.id) return;

  try {
    const updatedProject: SavedProject = {
      ...project,
      updatedAt: Date.now(),
    };

    localStorage.setItem(STORAGE_KEY_PREFIX + project.id, JSON.stringify(updatedProject));

    // Update index
    const indexRaw = localStorage.getItem(PROJECTS_INDEX_KEY);
    let index: string[] = indexRaw ? JSON.parse(indexRaw) : [];
    if (!index.includes(project.id)) {
      index.unshift(project.id);
      localStorage.setItem(PROJECTS_INDEX_KEY, JSON.stringify(index));
    }
  } catch (err) {
    console.warn("[ProjectStorage] Save failed (quota or disabled):", err);
  }
}

/**
 * Load a project from storage by ID
 */
export function loadProjectFromStorage(id: string): SavedProject | null {
  if (typeof window === "undefined" || !id) return null;

  try {
    const raw = localStorage.getItem(STORAGE_KEY_PREFIX + id);
    if (!raw) return null;
    return JSON.parse(raw) as SavedProject;
  } catch (err) {
    console.error(`[ProjectStorage] Error loading project ${id}:`, err);
    return null;
  }
}

/**
 * Delete a project from storage
 */
export function deleteProjectFromStorage(id: string): void {
  if (typeof window === "undefined" || !id) return;

  try {
    localStorage.removeItem(STORAGE_KEY_PREFIX + id);

    const indexRaw = localStorage.getItem(PROJECTS_INDEX_KEY);
    if (indexRaw) {
      const index: string[] = JSON.parse(indexRaw);
      const filtered = index.filter((item) => item !== id);
      localStorage.setItem(PROJECTS_INDEX_KEY, JSON.stringify(filtered));
    }
  } catch (err) {
    console.error(`[ProjectStorage] Error deleting project ${id}:`, err);
  }
}

/**
 * Create a fresh initial project object
 */
export function createNewProjectObject(name = "Untitled Project", framework: Framework = "nextjs"): SavedProject {
  const id = generateProjectId();
  const now = Date.now();
  const project: SavedProject = {
    id,
    name,
    framework,
    dbProvider: "none",
    authProvider: "none",
    files: {},
    messages: [
      {
        id: "init-1",
        role: "assistant",
        content: `Hello! I am Opendork. Describe any ${framework.toUpperCase()} website or app you would like to build.`,
        timestamp: now,
      },
    ],
    createdAt: now,
    updatedAt: now,
  };

  saveProjectToStorage(project);
  return project;
}
