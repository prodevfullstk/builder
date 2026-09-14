export type CheckStatus = 'passed' | 'failed' | 'skipped';

export interface ValidationCheck {
  name: string;
  status: CheckStatus;
  message?: string;
  details?: Record<string, any>;
}

export interface ValidationResult {
  valid: boolean;
  framework: string;
  checks: ValidationCheck[];
  diagnostics: string[];
}

export type VerificationLevel =
  | 'STATIC_VALIDATED'
  | 'VIRTUAL_PREVIEW_VALIDATED'
  | 'NATIVE_BUILD_VERIFIED'
  | 'NATIVE_BUILD_UNVERIFIED'
  | 'RUNTIME_SMOKE_VERIFIED'
  | 'REJECTED'
  | 'CONFLICT'
  | 'VERIFICATION_UNAVAILABLE';

export type NativeBuildStatus =
  | 'passed'
  | 'failed'
  | 'unavailable'
  | 'not_run'
  | 'stale'
  | 'invalid';

export interface NativeBuildRecord {
  attempted: boolean;
  status: NativeBuildStatus;
  framework: string;
  runner: string;
  environment: 'vercel_sandbox' | 'none';
  command?: string;
  exitCode?: number;
  durationMs?: number;
  stdoutSummary?: string;
  stderrSummary?: string;
  smokeTestPassed?: boolean;
  candidateHash?: string;
  projectId?: string;
  revision?: number;
  timestamp?: number | string;
  buildOutput?: string;
}

export interface ValidationEvidence {
  validationId: string;
  projectId: string;
  candidateId?: string;
  candidateTimestamp?: string;
  intentId?: string;
  candidateHash?: string;
  baselineRevision?: number;
  expectedRevision?: number;
  baselineHash?: string;
  changedFiles?: string[];
  changedSymbols?: string[];
  timestamp: string;
  startedAt?: string;
  completedAt?: string;
  framework: string;
  requestedFramework?: string;
  requestedFrameworkVersion?: string;
  resolvedFrameworkVersion?: string;
  verificationLevel?: VerificationLevel;
  nativeBuild?: NativeBuildRecord;
  checks: ValidationCheck[];
  accepted: boolean;
  diagnostics: string[];
  acceptanceCriteria?: any[];
  acceptanceResults?: any;
  retrievalContext?: any;
  provider?: string;
  model?: string;
  buildResult?: {
    success: boolean;
    errors?: string[];
    runner?: string;
  };
  runtimeResult?: {
    success: boolean;
    status?: string;
    runtimeUrl?: string;
  };
  visualResult?: {
    screenshotCaptured: boolean;
    comparisonStatus: string;
    verificationConfidence: number;
    visualMismatches?: any[];
    notes?: string;
  };
  runner?: string;
  commitRevision?: string;
}

export interface ProjectSpec {
  version: string;
  sourcePrompt: string;
  requirementsMarkdown: string;
  pages: string[];
  routes: string[];
  components: string[];
  dataModel?: any;
  acceptanceCriteria: string[];
  constraints: string[];
  securityRequirements: string[];
  framework: string;
  frameworkVersion: string;
  dbProvider?: string;
  authProvider?: string;
  createdAt: number;
  updatedAt: number;
}
