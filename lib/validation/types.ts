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
  checks: ValidationCheck[];
  accepted: boolean;
  diagnostics: string[];
}
