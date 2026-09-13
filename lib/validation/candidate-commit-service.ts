import { computeCandidateHash } from "@/lib/validation/candidate-pipeline";
import { ValidationEvidence } from "@/lib/validation/types";
import {
  getServerProject,
  updateServerProjectWithCas,
  verifyProjectOwnership,
  recordValidationEvidence,
  AuthoritativeProject,
} from "@/lib/storage/project-authority";

export interface CandidateCommitParams {
  projectId: string;
  expectedRevision: number;
  candidateFiles: Record<string, string>;
  candidateHash: string;
  validationEvidence: ValidationEvidence;
  userId: string;
  authMode?: "real" | "demo";
}

export interface CandidateCommitResult {
  success: boolean;
  committed?: boolean;
  conflict?: boolean;
  revision?: number;
  currentRevision?: number;
  expectedRevision?: number;
  error?: string;
  project?: AuthoritativeProject;
}

/**
 * Centralized Authoritative Candidate Commit Gate (GEN-501)
 *
 * Enforces:
 * 1. Authentication & Project Ownership
 * 2. Deterministic Hash Equality (candidateHash matches candidateFiles content digest)
 * 3. Evidence Hash Binding (evidence.candidateHash matches candidateHash)
 * 4. Validation Acceptance Gate (evidence.accepted === true)
 * 5. Native Verification Policy (untrusted code never runs on host, truthfulness recorded)
 * 6. Authoritative Database/Registry Compare-And-Swap (expectedRevision matches currentRevision)
 *
 * Any failure leaves the workspace untouched.
 */
export async function commitVerifiedCandidate(
  params: CandidateCommitParams
): Promise<CandidateCommitResult> {
  const {
    projectId,
    expectedRevision,
    candidateFiles,
    candidateHash,
    validationEvidence,
    userId,
    authMode,
  } = params;

  // 1. Ownership & Authorization Check
  const ownership = await verifyProjectOwnership(projectId, userId, authMode);
  if (!ownership.authorized) {
    return {
      success: false,
      committed: false,
      error: ownership.error || "Forbidden: Project access denied.",
    };
  }

  // 2. Candidate Integrity & Hash Validation
  const actualHash = computeCandidateHash(candidateFiles);
  if (actualHash !== candidateHash) {
    return {
      success: false,
      committed: false,
      error: `Candidate Integrity Error: Provided candidateHash '${candidateHash}' does not match computed digest '${actualHash}'.`,
    };
  }

  // 3. Evidence Binding Validation
  if (validationEvidence.candidateHash && validationEvidence.candidateHash !== actualHash) {
    return {
      success: false,
      committed: false,
      error: `Evidence Mismatch: Validation evidence candidateHash '${validationEvidence.candidateHash}' does not match candidate content '${actualHash}'.`,
    };
  }

  if (!validationEvidence.accepted) {
    return {
      success: false,
      committed: false,
      error: `Commit Gate Rejected: Candidate failed validation checks. Diagnostics: ${validationEvidence.diagnostics.join(" | ")}`,
    };
  }

  // 4. Server-Side Atomic Compare-And-Swap (CAS)
  const casResult = updateServerProjectWithCas(projectId, expectedRevision, {
    files: candidateFiles,
  });

  if (!casResult.success || casResult.conflict) {
    return {
      success: false,
      committed: false,
      conflict: true,
      currentRevision: casResult.currentRevision,
      expectedRevision: casResult.expectedRevision,
      error: casResult.error || "Conflict: Project revision advanced concurrently.",
    };
  }

  // 5. Audit Trail Persistence
  recordValidationEvidence(projectId, validationEvidence);

  return {
    success: true,
    committed: true,
    revision: casResult.revision,
    project: casResult.project,
  };
}
