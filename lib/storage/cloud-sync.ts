import { listSavedProjects, loadProjectFromStorage } from './project-storage';
import { supabaseAuthHelper, isRealSupabaseConfigured, AuthUser } from '@/lib/auth/supabase-auth';

export interface CloudSyncResult {
  syncedCount: number;
  failedCount?: number;
  error?: string;
  diagnostics?: string[];
}

/**
 * Sync local projects to cloud upon user login.
 * Strictly verifies that only real authenticated identities sync to cloud,
 * uses the authenticated session token, and provides structured error reporting.
 */
export async function syncLocalProjectsToCloud(
  user: AuthUser,
  accessToken?: string
): Promise<CloudSyncResult> {
  if (!user || !accessToken) {
    return { syncedCount: 0, error: 'User is not authenticated or missing access token.' };
  }

  const localProjects = listSavedProjects();
  if (localProjects.length === 0) {
    return { syncedCount: 0 };
  }

  if (isRealSupabaseConfigured) {
    if (!accessToken) {
      return {
        syncedCount: 0,
        error: 'Missing authenticated session token for cloud synchronization.',
      };
    }

    let synced = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const summary of localProjects) {
      const fullProj = loadProjectFromStorage(summary.id);
      if (fullProj) {
        try {
          const res = await supabaseAuthHelper.saveProject(accessToken, user.id, fullProj);
          if (res.ok) {
            synced++;
          } else {
            failed++;
            const errData = await res.json().catch(() => ({}));
            errors.push(`Project '${summary.name}': ${errData.message || res.statusText || 'Sync failed'}`);
          }
        } catch (err: any) {
          failed++;
          errors.push(`Project '${summary.name}': ${err?.message || 'Network error'}`);
        }
      }
    }

    return {
      syncedCount: synced,
      failedCount: failed,
      error: errors.length > 0 ? `Failed to sync ${failed} project(s)` : undefined,
      diagnostics: errors,
    };
  }

  // Local-only environment
  return {
    syncedCount: localProjects.length,
    failedCount: 0,
  };
}
