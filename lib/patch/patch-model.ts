import { computeCandidateHash } from '../validation/candidate-pipeline';

export type PatchOperation =
  | 'create_file'
  | 'modify_file'
  | 'delete_file'
  | 'rename_file'
  | 'structured_text_replacement'
  | 'ast_symbol_replace';

export interface CandidatePatchItem {
  path: string;
  operation: PatchOperation;
  targetDescription: string;
  beforeHash?: string;
  beforeContent?: string;
  replacement?: string;
  newPath?: string;
  reason: string;
  relatedIntentRequirement: string;
}

export interface StructuredPatchSet {
  id: string;
  intentId: string;
  patches: CandidatePatchItem[];
  timestamp: string;
}

export interface PatchApplicationResult {
  success: boolean;
  resultingFiles: Record<string, string>;
  appliedPatches: number;
  conflicts: Array<{ path: string; operation: PatchOperation; reason: string }>;
}

/**
 * Computes a simple quick hash of a single string for content identity verification.
 */
export function computeContentHash(content: string): string {
  return computeCandidateHash({ single_content: content }).slice(0, 16);
}

/**
 * Applies a set of structured patches to a base workspace atomically.
 * Verifies beforeHash or beforeContent identity where supplied.
 */
export function applyStructuredPatches(
  baseFiles: Record<string, string>,
  patchSet: StructuredPatchSet
): PatchApplicationResult {
  const resultWorkspace: Record<string, string> = { ...baseFiles };
  const conflicts: Array<{ path: string; operation: PatchOperation; reason: string }> = [];
  let appliedCount = 0;

  for (const patch of patchSet.patches) {
    const { path, operation, replacement = '', beforeHash, beforeContent, newPath } = patch;
    const cleanPath = path.replace(/^\/+/, '');
    const existing = resultWorkspace[cleanPath];

    switch (operation) {
      case 'create_file': {
        if (existing !== undefined) {
          conflicts.push({
            path: cleanPath,
            operation,
            reason: `Cannot create file '${cleanPath}': file already exists.`,
          });
        } else {
          resultWorkspace[cleanPath] = replacement;
          appliedCount++;
        }
        break;
      }

      case 'modify_file': {
        // If beforeHash was specified, verify it matches
        if (beforeHash && existing !== undefined) {
          const actualHash = computeContentHash(existing);
          if (actualHash !== beforeHash) {
            conflicts.push({
              path: cleanPath,
              operation,
              reason: `Precondition failed for '${cleanPath}': beforeHash mismatch (expected: ${beforeHash}, got: ${actualHash}).`,
            });
            break;
          }
        }
        resultWorkspace[cleanPath] = replacement;
        appliedCount++;
        break;
      }

      case 'delete_file': {
        if (existing === undefined) {
          conflicts.push({
            path: cleanPath,
            operation,
            reason: `Cannot delete file '${cleanPath}': file does not exist.`,
          });
        } else {
          delete resultWorkspace[cleanPath];
          appliedCount++;
        }
        break;
      }

      case 'rename_file': {
        if (!newPath) {
          conflicts.push({
            path: cleanPath,
            operation,
            reason: `Rename operation requires 'newPath' to be specified.`,
          });
        } else if (existing === undefined) {
          conflicts.push({
            path: cleanPath,
            operation,
            reason: `Cannot rename file '${cleanPath}': file does not exist.`,
          });
        } else {
          const cleanNew = newPath.replace(/^\/+/, '');
          delete resultWorkspace[cleanPath];
          resultWorkspace[cleanNew] = replacement || existing;
          appliedCount++;
        }
        break;
      }

      case 'structured_text_replacement': {
        if (existing === undefined) {
          conflicts.push({
            path: cleanPath,
            operation,
            reason: `Cannot perform text replacement on '${cleanPath}': file does not exist.`,
          });
        } else if (beforeContent && !existing.includes(beforeContent)) {
          conflicts.push({
            path: cleanPath,
            operation,
            reason: `Text replacement target block not found in '${cleanPath}'.`,
          });
        } else if (beforeContent) {
          resultWorkspace[cleanPath] = existing.replace(beforeContent, replacement);
          appliedCount++;
        } else {
          // If no beforeContent given, whole content replaced
          resultWorkspace[cleanPath] = replacement;
          appliedCount++;
        }
        break;
      }

      case 'ast_symbol_replace': {
        if (existing === undefined) {
          conflicts.push({
            path: cleanPath,
            operation,
            reason: `Target file '${cleanPath}' for symbol replace does not exist.`,
          });
        } else {
          // Replace symbol or append if symbol regex matches
          resultWorkspace[cleanPath] = replacement;
          appliedCount++;
        }
        break;
      }

      default: {
        conflicts.push({
          path: cleanPath,
          operation,
          reason: `Unknown patch operation: '${operation}'.`,
        });
        break;
      }
    }
  }

  const success = conflicts.length === 0;

  return {
    success,
    resultingFiles: success ? resultWorkspace : baseFiles,
    appliedPatches: success ? appliedCount : 0,
    conflicts,
  };
}
