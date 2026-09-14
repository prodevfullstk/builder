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
  candidateTimestamp?: number;
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

  // 2. Concurrency Pre-check (CAS)
  const currentProject = getServerProject(projectId);
  if (currentProject && currentProject.revision !== expectedRevision) {
    return {
      success: false,
      conflict: true,
      currentRevision: currentProject.revision,
      expectedRevision,
      error: `Conflict: Expected revision ${expectedRevision} does not match current revision ${currentProject.revision}.`,
    };
  }

  // 3. Evidence Context Binding (Project & Revision)
  if (validationEvidence.projectId && validationEvidence.projectId !== projectId) {
    return {
      success: false,
      committed: false,
      error: `Evidence Project Mismatch: Validation evidence was generated for project '${validationEvidence.projectId}', but target project is '${projectId}'.`,
    };
  }

  if (validationEvidence.expectedRevision !== undefined && validationEvidence.expectedRevision !== expectedRevision) {
    return {
      success: false,
      committed: false,
      error: `Evidence Revision Mismatch: Validation evidence bound to revision ${validationEvidence.expectedRevision}, but commit expected revision is ${expectedRevision}.`,
    };
  }

  // 4. Candidate Integrity & Hash Validation
  const actualHash = computeCandidateHash(candidateFiles);
  if (actualHash !== candidateHash) {
    return {
      success: false,
      committed: false,
      error: `Candidate Integrity Error: Provided candidateHash '${candidateHash}' does not match computed digest '${actualHash}'.`,
    };
  }

  // 5. Evidence Hash Binding Validation
  if (validationEvidence.candidateHash && validationEvidence.candidateHash !== actualHash) {
    return {
      success: false,
      committed: false,
      error: `Evidence Mismatch: Validation evidence candidateHash '${validationEvidence.candidateHash}' does not match candidate content '${actualHash}'.`,
    };
  }

  // 6. Evidence Expiration & Temporal Integrity Checks
  if (validationEvidence.timestamp) {
    const evidenceAge = Date.now() - new Date(validationEvidence.timestamp).getTime();
    if (!isNaN(evidenceAge) && evidenceAge > 15 * 60 * 1000) {
      return {
        success: false,
        committed: false,
        error: `Evidence Expired: Validation evidence expired (${Math.round(evidenceAge / 1000)}s old, max allowed: 900s).`,
      };
    }
  }

  // Check: Evidence must not predate candidate creation
  if (validationEvidence.candidateTimestamp && validationEvidence.timestamp) {
    const candTime = new Date(validationEvidence.candidateTimestamp).getTime();
    const evTime = new Date(validationEvidence.timestamp).getTime();
    if (!isNaN(candTime) && !isNaN(evTime) && evTime < candTime) {
      return {
        success: false,
        committed: false,
        error: `Evidence Temporal Integrity Violation: Validation evidence timestamp (${validationEvidence.timestamp}) predates candidate creation (${validationEvidence.candidateTimestamp}).`,
      };
    }
  }

  // Check: Evidence candidate timestamp must not predate requested candidate generation timestamp
  if (params.candidateTimestamp !== undefined && validationEvidence.candidateTimestamp) {
    const candGenTime = new Date(params.candidateTimestamp).getTime();
    const evCandTime = new Date(validationEvidence.candidateTimestamp).getTime();
    if (!isNaN(candGenTime) && !isNaN(evCandTime) && evCandTime < candGenTime) {
      return {
        success: false,
        committed: false,
        error: `Evidence Stale: Validation evidence candidateTimestamp (${validationEvidence.candidateTimestamp}) predates candidate generation timestamp (${params.candidateTimestamp}).`,
      };
    }
  }

  // Check: Missing validation ID
  if (!validationEvidence.validationId || validationEvidence.validationId.trim().length === 0) {
    return {
      success: false,
      committed: false,
      error: 'Evidence Integrity Violation: Missing validation evidence identifier.',
    };
  }

  if (!validationEvidence.accepted || validationEvidence.verificationLevel === 'REJECTED') {
    return {
      success: false,
      committed: false,
      error: `Commit Gate Rejected: Candidate failed validation checks. Diagnostics: ${(validationEvidence.diagnostics || []).join(" | ")}`,
    };
  }

  // 7. Native Verification Gate (GATE 1: nativeBuildStatus === "passed" is mandatory for authoritative commit)
  if (!validationEvidence.nativeBuild) {
    return {
      success: false,
      committed: false,
      error: 'Commit Gate Rejected: Native build verification is mandatory for authoritative commit.',
    };
  }

  const nativeBuildStatus = validationEvidence.nativeBuild.status;
  if (nativeBuildStatus !== 'passed') {
    return {
      success: false,
      committed: false,
      error: `Commit Gate Rejected: Native build failed or did not pass in isolated sandbox. Authoritative commit requires native build status 'passed'. Received: '${nativeBuildStatus || "not_run"}'.`,
    };
  }

  if (validationEvidence.nativeBuild.candidateHash && validationEvidence.nativeBuild.candidateHash !== actualHash) {
    return {
      success: false,
      committed: false,
      error: `Native Build Evidence Mismatch: Native build candidateHash '${validationEvidence.nativeBuild.candidateHash}' mismatches candidate hash '${actualHash}'.`,
    };
  }

  if (validationEvidence.nativeBuild.projectId && validationEvidence.nativeBuild.projectId !== projectId) {
    return {
      success: false,
      committed: false,
      error: `Native Build Project Mismatch: Native build projectId '${validationEvidence.nativeBuild.projectId}' mismatches target project '${projectId}'.`,
    };
  }

  // 8. Real Runtime Evidence Verification (Gate A)
  if (validationEvidence.realRuntime) {
    const rt = validationEvidence.realRuntime;
    if (!rt.healthy || (rt.httpStatus !== undefined && (rt.httpStatus < 200 || rt.httpStatus >= 400))) {
      return {
        success: false,
        committed: false,
        error: `Runtime Evidence Verification Failed: Application failed runtime smoke check (HTTP: ${rt.httpStatus || 'error'}).`,
      };
    }
    if (rt.candidateHash && rt.candidateHash !== actualHash) {
      return {
        success: false,
        committed: false,
        error: `Runtime Evidence Mismatch: candidateHash '${rt.candidateHash}' does not match candidate '${actualHash}'.`,
      };
    }
    if (rt.projectId && rt.projectId !== projectId) {
      return {
        success: false,
        committed: false,
        error: `Runtime Evidence Project Mismatch: '${rt.projectId}' does not match target project '${projectId}'.`,
      };
    }
  }

  // 9. Real Visual Evidence Verification (Gate B)
  if (validationEvidence.realVisual) {
    const vis = validationEvidence.realVisual;
    if (vis.comparisonStatus !== 'VERIFIED_MATCH') {
      return {
        success: false,
        committed: false,
        error: `Visual Evidence Verification Failed: Status '${vis.comparisonStatus}' is not certified match.`,
      };
    }
    if (vis.candidateHash && vis.candidateHash !== actualHash) {
      return {
        success: false,
        committed: false,
        error: `Visual Evidence Mismatch: candidateHash '${vis.candidateHash}' does not match candidate '${actualHash}'.`,
      };
    }
  }

  // 10. Real Behavioral Evidence Verification (Gate C)
  if (validationEvidence.realBehavioral && Array.isArray(validationEvidence.realBehavioral)) {
    for (const b of validationEvidence.realBehavioral) {
      if (!b.passed) {
        return {
          success: false,
          committed: false,
          error: `Behavioral Verification Failed on '${b.target}': ${b.observedResult}`,
        };
      }
      if (b.candidateHash && b.candidateHash !== actualHash) {
        return {
          success: false,
          committed: false,
          error: `Behavioral Evidence Mismatch: candidateHash '${b.candidateHash}' does not match candidate '${actualHash}'.`,
        };
      }
    }
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
