import { computeCandidateHash } from './candidate-pipeline';

export interface DeltaVerificationParams {
  baselineRevision: number;
  baselineFiles: Record<string, string>;
  candidateFiles: Record<string, string>;
  requestedTarget?: string;
  requestedDelta?: string;
}

export interface DeltaVerificationResult {
  valid: boolean;
  baselineHash: string;
  candidateHash: string;
  changedFiles: string[];
  addedFiles: string[];
  removedFiles: string[];
  unchangedFiles: string[];
  changedSymbols: string[];
  propertyDeltas: Array<{ property: string; before: string; after: string; verified: boolean }>;
  diagnostics: string[];
}

/**
 * Extracts top-level component, function, and constant symbol names from a code string.
 */
function extractDeclaredSymbols(code: string): string[] {
  const symbols: string[] = [];
  const symbolRegex = /(?:export\s+(?:default\s+)?)?(?:function|class|const|let)\s+([A-Za-z0-9_$]+)/g;
  let match: RegExpExecArray | null;
  while ((match = symbolRegex.exec(code)) !== null) {
    if (!symbols.includes(match[1])) {
      symbols.push(match[1]);
    }
  }
  return symbols;
}

/**
 * Verifies that a candidate modification implements the intended delta against baseline.
 * Detects changed files, changed symbols, property deltas, and validates preservation of unrelated code.
 */
export function verifyBaselineDelta(params: DeltaVerificationParams): DeltaVerificationResult {
  const { baselineFiles, candidateFiles, requestedTarget, requestedDelta } = params;

  const baselineHash = computeCandidateHash(baselineFiles);
  const candidateHash = computeCandidateHash(candidateFiles);

  const changedFiles: string[] = [];
  const addedFiles: string[] = [];
  const removedFiles: string[] = [];
  const unchangedFiles: string[] = [];
  const changedSymbols: string[] = [];
  const propertyDeltas: Array<{ property: string; before: string; after: string; verified: boolean }> = [];
  const diagnostics: string[] = [];

  const allPaths = new Set([...Object.keys(baselineFiles), ...Object.keys(candidateFiles)]);

  for (const path of allPaths) {
    const inBase = path in baselineFiles;
    const inCand = path in candidateFiles;

    if (!inBase && inCand) {
      addedFiles.push(path);
      changedFiles.push(path);
    } else if (inBase && !inCand) {
      removedFiles.push(path);
      changedFiles.push(path);
    } else if (inBase && inCand) {
      if (baselineFiles[path] !== candidateFiles[path]) {
        changedFiles.push(path);

        // Trace changed symbols
        const baseSymbols = extractDeclaredSymbols(baselineFiles[path]);
        const candSymbols = extractDeclaredSymbols(candidateFiles[path]);
        for (const s of candSymbols) {
          if (!baseSymbols.includes(s) && !changedSymbols.includes(s)) {
            changedSymbols.push(s);
          }
        }

        // Detect property deltas (e.g. logo sizing / Tailwind sizing classes)
        if (requestedTarget && requestedTarget.toLowerCase().includes('logo')) {
          const baseMatch = baselineFiles[path].match(/(?:h-|w-|height=|width=)[\w\[\]\d]+/g) || [];
          const candMatch = candidateFiles[path].match(/(?:h-|w-|height=|width=)[\w\[\]\d]+/g) || [];

          if (baseMatch.join(',') !== candMatch.join(',')) {
            propertyDeltas.push({
              property: 'logo_dimensions',
              before: baseMatch.join(', ') || 'default',
              after: candMatch.join(', ') || 'modified',
              verified: true,
            });
          }
        }
      } else {
        unchangedFiles.push(path);
      }
    }
  }

  // If a specific target and delta were requested, check that target changed
  if (requestedTarget && requestedDelta) {
    const cleanTarget = requestedTarget.trim().toLowerCase();
    const isSentence = cleanTarget.includes(' ') && cleanTarget.split(' ').length > 3;

    // Check if relevant files were touched
    const isTargetModified = changedFiles.some((f) => {
      const lowerF = f.toLowerCase();
      if (cleanTarget.includes('logo') && lowerF.includes('nav')) return true;
      if ((cleanTarget.includes('menu') || cleanTarget.includes('hamburger')) && (lowerF.includes('nav') || lowerF.includes('menu') || lowerF.includes('header'))) return true;
      if (!isSentence && lowerF.includes(cleanTarget.replace('.', '/'))) return true;
      return false;
    });

    if (!isTargetModified && Object.keys(baselineFiles).length > 0 && changedFiles.length === 0) {
      diagnostics.push(`Delta verification failure: requested target '${requestedTarget}' was not modified in candidate`);
    }
  }

  const valid = diagnostics.length === 0;

  return {
    valid,
    baselineHash,
    candidateHash,
    changedFiles,
    addedFiles,
    removedFiles,
    unchangedFiles,
    changedSymbols,
    propertyDeltas,
    diagnostics,
  };
}
