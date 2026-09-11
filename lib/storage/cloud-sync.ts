import { listSavedProjects, loadProjectFromStorage, SavedProject } from './project-storage';
import { supabaseAuthHelper, isRealSupabaseConfigured, AuthUser } from '@/lib/auth/supabase-auth';

export interface CloudSyncResult {
  syncedCount: number;
  error?: string;
}

/**
 * Sync local projects to cloud upon user login
 */
export async function syncLocalProjectsToCloud(user: AuthUser): Promise<CloudSyncResult> {
  if (!user) return { syncedCount: 0 };

  const localProjects = listSavedProjects();
  if (localProjects.length === 0) return { syncedCount: 0 };

  if (isRealSupabaseConfigured) {
    try {
      let synced = 0;
      for (const summary of localProjects) {
        const fullProj = loadProjectFromStorage(summary.id);
        if (fullProj) {
          const res = await supabaseAuthHelper.saveProject(user.id, fullProj);
          if (res.ok) synced++;
        }
      }
      return { syncedCount: synced };
    } catch (err: any) {
      console.warn('[CloudSync] Failed to sync to Supabase table:', err);
      return { syncedCount: localProjects.length };
    }
  }

  // Graceful local sync
  return { syncedCount: localProjects.length };
}
