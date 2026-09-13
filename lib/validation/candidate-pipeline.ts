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
  { name: 'GitHub Fine-Grained Personal Access Token', regex: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/ },
  { name: 'AWS Access Key ID', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'RSA Private Key', regex: /-----BEGIN (?:RSA )?PRIVATE KEY-----/ },
  { name: 'Generic Private Key', regex: /-----BEGIN OPENSSH PRIVATE KEY-----/ },
  { name: 'Supabase Service Role Key', regex: /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/ },
  { name: 'OpenAI Secret Key', regex: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'Anthropic API Key', regex: /\bsk-ant-[A-Za-z0-9_-]{32,}\b/ },
  { name: 'Groq API Key', regex: /\bgsk_[A-Za-z0-9_-]{32,}\b/ },
  { name: 'Google Gemini API Key', regex: /\bAIza[0-9A-Za-z-_]{32,}\b/ },
  { name: 'Stripe Secret Key', regex: /\b[rs]k_(?:live|test)_[A-Za-z0-9]{24,}\b/ },
  { name: 'PostgreSQL Connection URI with Password', regex: /postgres(?:ql)?:\/\/[^:]+:[^@]+@[^/]+\/[^\s"']+/i },
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
 * Invariants that must never be removed from requirements.md (SEC-306 / P1-5)
 */
const REQUIRED_REQUIREMENTS_INVARIANTS = [
  { term: /tenant\s*isolation/i, label: 'Tenant isolation' },
  { term: /secret|credential|token/i, label: 'Zero leaked credentials' },
  { term: /row-level\s*security|rls/i, label: 'Row-Level Security' },
];

export function validateRequirementsProtection(
  currentFiles: Record<string, string>,
  candidateFiles: Record<string, string | null>,
  candidateWorkspace: Record<string, string>
): { check: ValidationCheck; diagnostics: string[] } {
  const hadRequirements = 'requirements.md' in currentFiles || '/requirements.md' in currentFiles;

  // If previous workspace didn't have requirements.md, pass
  if (!hadRequirements) {
    return {
      check: {
        name: 'requirements_protection',
        status: 'passed',
        message: 'No existing requirements specification to protect.',
      },
      diagnostics: [],
    };
  }

  // 1. Check if candidate explicitly deleted requirements.md
  const isDeleted =
    candidateFiles['requirements.md'] === null ||
    candidateFiles['/requirements.md'] === null ||
    (!('requirements.md' in candidateWorkspace) && !('/requirements.md' in candidateWorkspace));

  if (isDeleted) {
    return {
      check: {
        name: 'requirements_protection',
        status: 'failed',
        message: 'Security Violation: Deletion of requirements.md is strictly forbidden.',
      },
      diagnostics: [
        'Security Violation: Cannot delete requirements.md. Project specifications are protected.',
      ],
    };
  }

  // 2. Check if modified requirements.md weakened declared security invariants
  const currentReqs = currentFiles['requirements.md'] || currentFiles['/requirements.md'] || '';
  const newReqs = candidateWorkspace['requirements.md'] || candidateWorkspace['/requirements.md'] || '';

  const missingInvariants: string[] = [];
  for (const inv of REQUIRED_REQUIREMENTS_INVARIANTS) {
    if (inv.term.test(currentReqs) && !inv.term.test(newReqs)) {
      missingInvariants.push(inv.label);
    }
  }

  if (missingInvariants.length > 0) {
    return {
      check: {
        name: 'requirements_protection',
        status: 'failed',
        message: `Security Violation: requirements.md modifications removed mandatory security invariants: ${missingInvariants.join(', ')}.`,
      },
      diagnostics: [
        `Security Violation: Weakening declared security invariants (${missingInvariants.join(', ')}) in requirements.md is forbidden.`,
      ],
    };
  }

  return {
    check: {
      name: 'requirements_protection',
      status: 'passed',
      message: 'requirements.md specification and security invariants intact.',
    },
    diagnostics: [],
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

  // Check 1: Requirements Protection (SEC-306 / P1-5)
  const reqResult = validateRequirementsProtection(currentFiles, candidateFiles, candidateWorkspace);
  allChecks.push(reqResult.check);
  allDiagnostics.push(...reqResult.diagnostics);

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
