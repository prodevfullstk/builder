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

export interface ValidationEvidence {
  validationId: string;
  projectId: string;
  timestamp: string;
  framework: string;
  requestedFramework?: string;
  requestedFrameworkVersion?: string;
  resolvedFrameworkVersion?: string;
  checks: ValidationCheck[];
  accepted: boolean;
  diagnostics: string[];
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
