import { IntentContract } from '../ai/intent-contract';
import { RetrievalContext } from '../workspace/project-retrieval';

export interface ScopeEnforcementResult {
  allowed: boolean;
  touchedFiles: string[];
  expectedFiles: string[];
  unrelatedFiles: string[];
  suspiciousRewrites: string[];
  diagnostics: string[];
}

/**
 * Validates that candidate modifications are minimally scoped to the requested intent.
 * Rejects broad, suspicious rewrites that touch unrelated project files.
 */
export function enforceMinimalScope(params: {
  intent: IntentContract;
  baselineFiles: Record<string, string>;
  candidateFiles: Record<string, string>;
  retrievalContext?: RetrievalContext;
}): ScopeEnforcementResult {
  const { intent, baselineFiles, candidateFiles, retrievalContext } = params;

  // New projects create whole project; scope restriction applies to existing project modifications
  if (intent.action === 'CREATE_PROJECT' || Object.keys(baselineFiles).length === 0) {
    return {
      allowed: true,
      touchedFiles: Object.keys(candidateFiles),
      expectedFiles: Object.keys(candidateFiles),
      unrelatedFiles: [],
      suspiciousRewrites: [],
      diagnostics: [],
    };
  }

  // Identify touched files
  const touchedFiles: string[] = [];
  const allPaths = new Set([...Object.keys(baselineFiles), ...Object.keys(candidateFiles)]);
  for (const path of allPaths) {
    if (baselineFiles[path] !== candidateFiles[path]) {
      touchedFiles.push(path);
    }
  }

  // Formulate set of expected / permissible files based on intent and retrieval
  const expectedFilesSet = new Set<string>();

  // Explicit target files from intent
  if (intent.targetFiles) {
    for (const f of intent.targetFiles) expectedFilesSet.add(f.replace(/^\/+/, ''));
  }

  // Files discovered during retrieval
  if (retrievalContext) {
    for (const f of retrievalContext.matchedFiles) expectedFilesSet.add(f);
    for (const f of retrievalContext.relatedFiles) expectedFilesSet.add(f);
  }

  // Keywords in target description (e.g. navbar, logo, header, menu)
  const lowerDesc = intent.targetDescription.toLowerCase();
  for (const path of Object.keys(baselineFiles)) {
    const clean = path.replace(/^\/+/, '');
    const lower = clean.toLowerCase();

    if (lowerDesc.includes('navbar') || lowerDesc.includes('logo')) {
      if (lower.includes('navbar') || lower.includes('header') || lower.includes('logo') || lower.includes('nav')) {
        expectedFilesSet.add(clean);
      }
    }
    if (lowerDesc.includes('hamburger') || lowerDesc.includes('menu')) {
      if (lower.includes('navbar') || lower.includes('header') || lower.includes('menu') || lower.includes('nav') || lower.includes('layout')) {
        expectedFilesSet.add(clean);
      }
    }
  }

  // If intent didn't specify target files and retrieval had none, allow page.tsx or App.tsx
  if (expectedFilesSet.size === 0) {
    if (baselineFiles['app/page.tsx']) expectedFilesSet.add('app/page.tsx');
    if (baselineFiles['src/App.tsx']) expectedFilesSet.add('src/App.tsx');
  }

  const unrelatedFiles: string[] = [];
  const suspiciousRewrites: string[] = [];
  const diagnostics: string[] = [];

  for (const touched of touchedFiles) {
    const isExpected = expectedFilesSet.has(touched);
    if (!isExpected) {
      // Check if this was a critical or unrelated file being rewritten without intent
      const isCritical = touched === 'package.json' || touched === 'tsconfig.json' || touched.endsWith('.config.js');
      if (isCritical && !lowerDesc.includes('config') && !lowerDesc.includes('package') && !lowerDesc.includes('dependency')) {
        suspiciousRewrites.push(touched);
        diagnostics.push(`Scope Violation: Critical file '${touched}' was modified without explicit intent requirement.`);
      } else {
        unrelatedFiles.push(touched);
      }
    }
  }

  // Targeted single-element requests (e.g. "make navbar logo 20% smaller") should not rewrite > 3 files
  const isTargetedMicroEdit = lowerDesc.includes('logo') || lowerDesc.includes('color') || lowerDesc.includes('typo') || lowerDesc.includes('smaller');
  if (isTargetedMicroEdit && touchedFiles.length > 3) {
    diagnostics.push(
      `Scope Violation: Targeted edit '${intent.targetDescription}' modified ${touchedFiles.length} files. Maximum allowed for micro-edit is 3.`
    );
  }

  const allowed = suspiciousRewrites.length === 0 && diagnostics.length === 0;

  return {
    allowed,
    touchedFiles,
    expectedFiles: Array.from(expectedFilesSet),
    unrelatedFiles,
    suspiciousRewrites,
    diagnostics,
  };
}
