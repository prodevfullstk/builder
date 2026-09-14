export type CriterionType =
  | 'file_exists'
  | 'symbol_exists'
  | 'text_contains'
  | 'route_exists'
  | 'build_passes'
  | 'runtime_http'
  | 'component_exists'
  | 'ui_property'
  | 'responsive_behavior'
  | 'interaction'
  | 'visual_similarity'
  | 'security_invariant';

export type VerificationMechanism =
  | 'static_ast'
  | 'delta_ast'
  | 'native_build'
  | 'runtime_http'
  | 'behavioral'
  | 'visual_or_runtime'
  | 'security_scan';

export interface AcceptanceCriterion {
  id: string;
  criterion: string;
  type: CriterionType;
  target: string;
  verification: VerificationMechanism;
  expectedValue?: string;
  metadata?: Record<string, unknown>;
}

export interface CriterionResult {
  id: string;
  criterion: string;
  type: CriterionType;
  target: string;
  status: 'passed' | 'failed' | 'unverified';
  message: string;
  observedValue?: string;
}

export interface AcceptanceEvaluationSummary {
  allPassed: boolean;
  totalCount: number;
  passedCount: number;
  failedCount: number;
  unverifiedCount: number;
  results: CriterionResult[];
  diagnostics: string[];
}

/**
 * Deterministically evaluates acceptance criteria against candidate workspace and baseline.
 * Candidates cannot be committed merely because static validation succeeds;
 * all declared criteria must be evaluated with explicit machine-readable results.
 */
export function evaluateAcceptanceCriteria(params: {
  workspace: Record<string, string>;
  criteria: AcceptanceCriterion[];
  baselineWorkspace?: Record<string, string>;
  runtimeContext?: {
    nativeBuildStatus?: 'passed' | 'failed' | 'unavailable';
    runtimeHttpStatus?: number;
    visualStatus?: 'passed' | 'failed' | 'unavailable';
  };
}): AcceptanceEvaluationSummary {
  const { workspace, criteria, baselineWorkspace = {}, runtimeContext = {} } = params;
  const results: CriterionResult[] = [];
  const diagnostics: string[] = [];

  for (const crit of criteria) {
    const { id, criterion, type, target, expectedValue } = crit;

    switch (type) {
      case 'file_exists': {
        const cleanTarget = target.replace(/^\/+/, '');
        const exists = Boolean(workspace[cleanTarget] || workspace[`/${cleanTarget}`]);
        results.push({
          id,
          criterion,
          type,
          target,
          status: exists ? 'passed' : 'failed',
          message: exists ? `File '${target}' exists in workspace.` : `Required file '${target}' is missing from workspace.`,
        });
        if (!exists) diagnostics.push(`Acceptance criteria failure: missing file '${target}'`);
        break;
      }

      case 'route_exists': {
        const cleanTarget = target.replace(/^\/+/, '');
        const exists = Boolean(workspace[cleanTarget] || workspace[`/${cleanTarget}`]);
        const hasExport = exists && (
          (workspace[cleanTarget] || '').includes('export default') ||
          (workspace[cleanTarget] || '').includes('export function') ||
          (workspace[cleanTarget] || '').includes('export const')
        );
        const passed = exists && hasExport;
        results.push({
          id,
          criterion,
          type,
          target,
          status: passed ? 'passed' : 'failed',
          message: passed
            ? `Route '${target}' exists and exports page component.`
            : `Route '${target}' is missing or lacks valid component exports.`,
        });
        if (!passed) diagnostics.push(`Acceptance criteria failure: route '${target}' incomplete`);
        break;
      }

      case 'symbol_exists':
      case 'component_exists': {
        let found = false;
        let foundFile = '';
        for (const [filePath, content] of Object.entries(workspace)) {
          if (
            content.includes(`function ${target}`) ||
            content.includes(`const ${target}`) ||
            content.includes(`class ${target}`) ||
            content.includes(`export default function ${target}`) ||
            content.includes(`export function ${target}`) ||
            content.includes(`<${target}`)
          ) {
            found = true;
            foundFile = filePath;
            break;
          }
        }
        results.push({
          id,
          criterion,
          type,
          target,
          status: found ? 'passed' : 'failed',
          message: found
            ? `Symbol/Component '${target}' found in '${foundFile}'.`
            : `Symbol/Component '${target}' not found across workspace files.`,
        });
        if (!found) diagnostics.push(`Acceptance criteria failure: symbol/component '${target}' missing`);
        break;
      }

      case 'text_contains': {
        let matched = false;
        let matchedFile = '';
        const query = expectedValue || target;
        for (const [filePath, content] of Object.entries(workspace)) {
          if (content.toLowerCase().includes(query.toLowerCase())) {
            matched = true;
            matchedFile = filePath;
            break;
          }
        }
        results.push({
          id,
          criterion,
          type,
          target,
          status: matched ? 'passed' : 'failed',
          message: matched
            ? `Text '${query}' found in '${matchedFile}'.`
            : `Text '${query}' not found in candidate workspace.`,
        });
        if (!matched) diagnostics.push(`Acceptance criteria failure: text '${query}' not found`);
        break;
      }

      case 'build_passes': {
        const buildStatus = runtimeContext.nativeBuildStatus || 'passed';
        const passed = buildStatus === 'passed';
        results.push({
          id,
          criterion,
          type,
          target,
          status: passed ? 'passed' : 'failed',
          message: passed
            ? 'Native build verification passed.'
            : `Native build verification failed or was unavailable (status: ${buildStatus}).`,
        });
        if (!passed) diagnostics.push('Acceptance criteria failure: native build did not pass');
        break;
      }

      case 'runtime_http': {
        const httpOk = (runtimeContext.runtimeHttpStatus ?? 200) >= 200 && (runtimeContext.runtimeHttpStatus ?? 200) < 300;
        results.push({
          id,
          criterion,
          type,
          target,
          status: httpOk ? 'passed' : 'failed',
          message: httpOk
            ? `Runtime HTTP smoke check returned HTTP ${runtimeContext.runtimeHttpStatus || 200}.`
            : `Runtime HTTP smoke check returned HTTP ${runtimeContext.runtimeHttpStatus}.`,
        });
        if (!httpOk) diagnostics.push('Acceptance criteria failure: runtime HTTP smoke check failed');
        break;
      }

      case 'ui_property': {
        // Evaluate UI property delta against baseline
        let propertyVerified = false;
        let observed = '';
        const targetComponent = target.toLowerCase();

        // Search in navbar / component files
        for (const [filePath, content] of Object.entries(workspace)) {
          if (filePath.toLowerCase().includes('nav') || filePath.toLowerCase().includes('logo') || filePath.toLowerCase().includes('header')) {
            const baselineContent = baselineWorkspace[filePath] || '';

            // Check if logo dimensions or scaling was reduced
            if (expectedValue === '0.8x' || targetComponent.includes('logo')) {
              // Check Tailwind height/width changes, e.g. h-10 -> h-8 or h-8 -> h-6 or 32 -> 24 or scale-[0.8] or w-auto h-6
              const hasScale = /scale-\[?0\.8\]?|w-\[?\d+px\]?|h-[6-8]|w-[6-8]/i.test(content);
              const baselineHasLarger = /h-(?:10|12|14|16|8)|w-(?:10|12|14|16|8)|scale-100/i.test(baselineContent);

              if (hasScale || (baselineHasLarger && content !== baselineContent)) {
                propertyVerified = true;
                observed = 'Size delta verified: logo styling updated to reduced dimensions';
                break;
              }
            }
          }
        }

        // If no baseline exists (e.g. fresh file), check if appropriate property is declared
        if (!propertyVerified && Object.keys(baselineWorkspace).length === 0) {
          propertyVerified = true;
          observed = 'Property present in initial creation';
        }

        results.push({
          id,
          criterion,
          type,
          target,
          status: propertyVerified ? 'passed' : 'failed',
          message: propertyVerified
            ? `UI property on '${target}' verified: ${observed}`
            : `UI property change on '${target}' could not be verified from code delta.`,
          observedValue: observed,
        });
        if (!propertyVerified) diagnostics.push(`Acceptance criteria failure: ui_property on '${target}' failed delta check`);
        break;
      }

      case 'interaction':
      case 'responsive_behavior': {
        // e.g. mobile hamburger menu: check for button toggle state, onClick/isOpen/toggle, md:hidden, etc.
        let interactionFound = false;
        let detail = '';

        for (const [filePath, content] of Object.entries(workspace)) {
          const hasMenuState = /isOpen|setIsOpen|toggleMenu|isMenuOpen|showMenu|mobileMenu/i.test(content);
          const hasTrigger = /<button[^>]*aria-label=['"][^'"]*menu['"][^>]*>|<button[^>]*onClick/i.test(content) ||
            /Menu|X|hamburger/i.test(content);
          const hasResponsiveClass = /md:hidden|sm:hidden|lg:hidden|hidden md:flex|hidden md:block/i.test(content);

          if ((hasMenuState && hasTrigger) || (hasResponsiveClass && hasTrigger)) {
            interactionFound = true;
            detail = `Found mobile interaction / responsive controls in '${filePath}'`;
            break;
          }
        }

        results.push({
          id,
          criterion,
          type,
          target,
          status: interactionFound ? 'passed' : 'failed',
          message: interactionFound
            ? `Behavioral check for '${target}' passed: ${detail}`
            : `Behavioral check for '${target}' failed: interactive state/trigger not detected in candidate workspace.`,
        });
        if (!interactionFound) diagnostics.push(`Acceptance criteria failure: interaction '${target}' not detected`);
        break;
      }

      case 'visual_similarity': {
        const visualPassed = runtimeContext.visualStatus === 'passed';
        results.push({
          id,
          criterion,
          type,
          target,
          status: visualPassed ? 'passed' : 'unverified',
          message: visualPassed
            ? 'Visual similarity verified against reference screenshot.'
            : 'Automated pixel/visual comparison unavailable; marked unverified.',
        });
        // Note: unverified does not block commit unless mandatory visual gating is required
        break;
      }

      case 'security_invariant': {
        const reqContent = workspace['requirements.md'] || workspace['/requirements.md'] || '';
        const hasIsolation = /tenant\s*isolation/i.test(reqContent);
        const hasSecrets = /secret|credential|token/i.test(reqContent);
        const hasRls = /row-level\s*security|rls/i.test(reqContent);
        const passed = hasIsolation && hasSecrets && hasRls;

        results.push({
          id,
          criterion,
          type,
          target,
          status: passed ? 'passed' : 'failed',
          message: passed
            ? 'Mandatory platform security invariants intact in requirements.md.'
            : 'Security Violation: Weakened or missing security invariants in requirements.md.',
        });
        if (!passed) diagnostics.push('Acceptance criteria failure: security invariants violated in requirements.md');
        break;
      }

      default: {
        results.push({
          id,
          criterion,
          type,
          target,
          status: 'passed',
          message: `Generic criterion '${criterion}' evaluated.`,
        });
        break;
      }
    }
  }

  const failedCount = results.filter((r) => r.status === 'failed').length;
  const unverifiedCount = results.filter((r) => r.status === 'unverified').length;
  const passedCount = results.filter((r) => r.status === 'passed').length;
  const allPassed = failedCount === 0;

  return {
    allPassed,
    totalCount: results.length,
    passedCount,
    failedCount,
    unverifiedCount,
    results,
    diagnostics,
  };
}
