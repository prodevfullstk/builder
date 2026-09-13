import { ValidationCheck, ValidationEvidence, ValidationResult } from './types';
import { validateFrameworkContract } from './framework-validator';

export interface CandidateEvaluationResult {
  accepted: boolean;
  committedFiles: Record<string, string>;
  evidence: ValidationEvidence;
  diagnostics: string[];
}

/**
 * Deterministically computes a stable SHA-256 digest of candidate files.
 * Uses an isomorphic bitwise SHA-256 algorithm that works identically in both
 * Node.js and browser webpack client bundles without 'node:crypto' bundling errors.
 */
function sha256Hex(ascii: string): string {
  function rightRotate(value: number, amount: number) {
    return (value >>> amount) | (value << (32 - amount));
  }

  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  const lengthProperty = 'length';
  let i: number, j: number;
  let result = '';

  const words: number[] = [];
  const asciiBitLength = ascii[lengthProperty] * 8;

  let hash = (sha256Hex as any).h = (sha256Hex as any).h || [];
  const k = (sha256Hex as any).k = (sha256Hex as any).k || [];
  let primeCounter = k[lengthProperty];

  const isComposite: Record<number, number> = {};
  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (i = 0; i < 300; i += candidate) {
        isComposite[i] = candidate;
      }
      hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
    }
  }

  ascii += '\x80';
  while ((ascii[lengthProperty] % 64) - 56) ascii += '\x00';
  for (i = 0; i < ascii[lengthProperty]; i++) {
    j = ascii.charCodeAt(i);
    words[i >> 2] |= j << (((3 - i) % 4) * 8);
  }
  words[words[lengthProperty]] = (asciiBitLength / maxWord) | 0;
  words[words[lengthProperty]] = asciiBitLength | 0;

  for (j = 0; j < words[lengthProperty]; ) {
    const w = words.slice(j, (j += 16));
    const oldHash = hash;
    hash = hash.slice(0, 8);

    for (i = 0; i < 64; i++) {
      const w15 = w[i - 15],
        w2 = w[i - 2];
      const s0 = rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3);
      const s1 = rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10);
      w[i] =
        i < 16
          ? w[i]
          : (w[i - 16] + s0 + w[i - 7] + s1) | 0;

      const s1h =
        rightRotate(hash[4], 6) ^
        rightRotate(hash[4], 11) ^
        rightRotate(hash[4], 25);
      const ch = (hash[4] & hash[5]) ^ (~hash[4] & hash[6]);
      const temp1 = (hash[7] + s1h + ch + k[i] + w[i]) | 0;
      const s0h =
        rightRotate(hash[0], 2) ^
        rightRotate(hash[0], 13) ^
        rightRotate(hash[0], 22);
      const maj =
        (hash[0] & hash[1]) ^
        (hash[0] & hash[2]) ^
        (hash[1] & hash[2]);
      const temp2 = (s0h + maj) | 0;

      hash = [(temp1 + temp2) | 0].concat(hash);
      hash[4] = (hash[4] + temp1) | 0;
    }

    for (i = 0; i < 8; i++) {
      hash[i] = (hash[i] + oldHash[i]) | 0;
    }
  }

  for (i = 0; i < 8; i++) {
    for (let b = 3; b >= 0; b--) {
      const byte = (hash[i] >> (b * 8)) & 255;
      result += (byte < 16 ? '0' : '') + byte.toString(16);
    }
  }
  return result;
}

/**
 * Deterministically computes SHA-256 hash of candidate files dictionary.
 * Sorts file paths alphabetically to guarantee stable content digests across all runtimes.
 */
export function computeCandidateHash(files: Record<string, string>): string {
  const sortedKeys = Object.keys(files).sort();
  let serialized = '';
  for (const key of sortedKeys) {
    serialized += `${key}\0${files[key] ?? ''}\0`;
  }
  return sha256Hex(serialized);
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
  const candidateHash = computeCandidateHash(candidateWorkspace);

  const evidence: ValidationEvidence = {
    validationId,
    projectId: projectId || 'transient-workspace',
    candidateHash,
    timestamp,
    framework,
    verificationLevel: accepted ? 'STATIC_VALIDATED' : 'REJECTED',
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
