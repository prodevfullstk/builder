import { ValidationCheck, ValidationEvidence, ValidationResult } from './types';
import { validateFrameworkContract } from './framework-validator';

export interface CandidateEvaluationResult {
  accepted: boolean;
  committedFiles: Record<string, string>;
  evidence: ValidationEvidence;
  diagnostics: string[];
}

/**
 * Secret patterns that must never be committed into project state
 */
const SECRET_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: 'GitHub Personal Access Token', regex: /\bghp_[A-Za-z0-9_]{36,}\b/ },
  { name: 'GitHub OAuth Access Token', regex: /\bgho_[A-Za-z0-9_]{36,}\b/ },
  { name: 'AWS Access Key ID', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'RSA Private Key', regex: /-----BEGIN (?:RSA )?PRIVATE KEY-----/ },
  { name: 'Generic Private Key', regex: /-----BEGIN OPENSSH PRIVATE KEY-----/ },
  { name: 'Supabase Service Role Key', regex: /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/ },
  { name: 'OpenAI Secret Key', regex: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
];

/**
 * Deterministic secret scanner
 */
export function scanForSecrets(files: Record<string, string>): { hasSecrets: boolean; checks: ValidationCheck[]; diagnostics: string[] } {
  const checks: ValidationCheck[] = [];
  const diagnostics: string[] = [];
  let leakedCount = 0;

  for (const [path, content] of Object.entries(files)) {
    if (typeof content !== 'string') continue;
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.regex.test(content)) {
        leakedCount++;
        diagnostics.push(`Security Violation: Found ${pattern.name} in file '${path}'. Credentials must not be committed.`);
      }
    }
  }

  if (leakedCount > 0) {
    checks.push({
      name: 'secret_leak_scan',
      status: 'failed',
      message: `Detected ${leakedCount} hardcoded secret/credential(s) in candidate files.`,
    });
  } else {
    checks.push({
      name: 'secret_leak_scan',
      status: 'passed',
      message: 'Zero leaked credentials or secrets detected.',
    });
  }

  return {
    hasSecrets: leakedCount > 0,
    checks,
    diagnostics,
  };
}

/**
 * Evaluates candidate edits atomically.
 *
 * Requirements:
 * - AI output is a candidate, NOT evidence of success.
 * - If validation fails:
 *   - do not silently commit invalid changes
 *   - preserve previous known-good project
 *   - expose diagnostics
 *   - generate machine-readable validation evidence
 * - Only commit after successful validation.
 */
export async function evaluateCandidateChanges(params: {
  projectId: string;
  framework: string;
  currentFiles: Record<string, string>;
  candidateFiles: Record<string, string | null>;
  isNewBuild?: boolean;
}): Promise<CandidateEvaluationResult> {
  const { projectId, framework, currentFiles, candidateFiles, isNewBuild = false } = params;
  const validationId = 'val_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);
  const timestamp = new Date().toISOString();

  // 1. Construct candidate workspace with proper deletion handling
  const candidateWorkspace: Record<string, string> = isNewBuild
    ? {}
    : { ...currentFiles };

  for (const [filePath, content] of Object.entries(candidateFiles)) {
    if (content === null || content === undefined) {
      delete candidateWorkspace[filePath];
    } else {
      candidateWorkspace[filePath] = content;
    }
  }

  const allChecks: ValidationCheck[] = [];
  const allDiagnostics: string[] = [];

  // Check 2: Secret Scan
  const secretResult = scanForSecrets(candidateWorkspace);
  allChecks.push(...secretResult.checks);
  allDiagnostics.push(...secretResult.diagnostics);

  // Check 3: Deterministic Framework Contract
  const frameworkResult = validateFrameworkContract(framework, candidateWorkspace);
  allChecks.push(...frameworkResult.checks);
  allDiagnostics.push(...frameworkResult.diagnostics);

  // Check 4: Non-empty Workspace Check
  if (Object.keys(candidateWorkspace).length === 0) {
    allChecks.push({
      name: 'workspace_non_empty',
      status: 'failed',
      message: 'Candidate workspace contains 0 files.',
    });
    allDiagnostics.push('Validation failure: Candidate workspace contains 0 files.');
  } else {
    allChecks.push({
      name: 'workspace_non_empty',
      status: 'passed',
      message: `Workspace contains ${Object.keys(candidateWorkspace).length} files.`,
    });
  }

  const anyFailed = allChecks.some((c) => c.status === 'failed');
  const accepted = !anyFailed;

  const evidence: ValidationEvidence = {
    validationId,
    projectId: projectId || 'transient-workspace',
    timestamp,
    framework,
    checks: allChecks,
    accepted,
    diagnostics: allDiagnostics,
  };

  if (!accepted) {
    // REJECT: Preserve the previous known-good project untouched
    return {
      accepted: false,
      committedFiles: currentFiles, // previous state remains intact!
      evidence,
      diagnostics: allDiagnostics,
    };
  }

  // ACCEPT: Commit accepted changes to the authoritative workspace
  return {
    accepted: true,
    committedFiles: candidateWorkspace,
    evidence,
    diagnostics: [],
  };
}
