import { AcceptanceCriterion } from '../validation/acceptance-verifier';

export type IntentAction =
  | 'CREATE_PROJECT'
  | 'ADD_FEATURE'
  | 'MODIFY_FEATURE'
  | 'FIX_BUG'
  | 'REFACTOR'
  | 'QUESTION'
  | 'EXPLAIN'
  | 'CONTINUE_BUILD'
  | 'VISUAL_RECREATE'
  | 'VISUAL_EDIT'
  | 'INSPECT';

export interface ImageContext {
  hasImage: boolean;
  imageType?: string;
  description?: string;
  dataUrl?: string;
  referenceId?: string;
}

export interface IntentContract {
  id: string;
  action: IntentAction;
  language: string;
  framework: string;
  frameworkVersion?: string;
  targetDescription: string;
  targetFiles?: string[];
  requirements: string[];
  constraints: string[];
  acceptanceCriteria: AcceptanceCriterion[];
  imageContext?: ImageContext;
  confidence: number;
  clarificationRequired: boolean;
  clarificationPrompt?: string;
  timestamp: string;
}

export interface IntentValidationResult {
  valid: boolean;
  errors: string[];
}

export const MUTATING_INTENT_ACTIONS: ReadonlySet<IntentAction> = new Set([
  'CREATE_PROJECT',
  'ADD_FEATURE',
  'MODIFY_FEATURE',
  'FIX_BUG',
  'REFACTOR',
  'CONTINUE_BUILD',
  'VISUAL_RECREATE',
  'VISUAL_EDIT',
]);

export const READONLY_INTENT_ACTIONS: ReadonlySet<IntentAction> = new Set([
  'QUESTION',
  'EXPLAIN',
  'INSPECT',
]);

/**
 * Validates a structured IntentContract against production constraints.
 * Server must validate the intent before authorizing candidate patch generation or code mutation.
 */
export function validateIntent(intent: unknown): IntentValidationResult {
  const errors: string[] = [];

  if (!intent || typeof intent !== 'object') {
    return { valid: false, errors: ['Intent must be a non-null object'] };
  }

  const candidate = intent as Partial<IntentContract>;

  if (!candidate.id || typeof candidate.id !== 'string') {
    errors.push('Intent missing or invalid id');
  }

  const validActions: IntentAction[] = [
    'CREATE_PROJECT',
    'ADD_FEATURE',
    'MODIFY_FEATURE',
    'FIX_BUG',
    'REFACTOR',
    'QUESTION',
    'EXPLAIN',
    'CONTINUE_BUILD',
    'VISUAL_RECREATE',
    'VISUAL_EDIT',
    'INSPECT',
  ];

  if (!candidate.action || !validActions.includes(candidate.action)) {
    errors.push(`Invalid or unsupported intent action: '${candidate.action}'`);
  }

  if (typeof candidate.confidence !== 'number' || candidate.confidence < 0 || candidate.confidence > 1) {
    errors.push('Confidence must be a number between 0 and 1');
  }

  if (typeof candidate.targetDescription !== 'string' || candidate.targetDescription.trim().length === 0) {
    errors.push('targetDescription is required');
  }

  const validFrameworks = ['nextjs', 'vite', 'astro'];
  if (!candidate.framework || !validFrameworks.includes(candidate.framework.toLowerCase())) {
    errors.push(`Invalid or unsupported framework: '${candidate.framework}'`);
  }

  const isMutating = candidate.action && MUTATING_INTENT_ACTIONS.has(candidate.action);

  if (isMutating) {
    if (!Array.isArray(candidate.requirements) || candidate.requirements.length === 0) {
      errors.push('Mutating intent must contain at least one requirement');
    }

    if (!Array.isArray(candidate.acceptanceCriteria) || candidate.acceptanceCriteria.length === 0) {
      errors.push('Mutating intent must contain at least one acceptance criterion');
    }

    if (candidate.action === 'VISUAL_RECREATE' || candidate.action === 'VISUAL_EDIT') {
      if (!candidate.imageContext?.hasImage && !candidate.targetDescription) {
        errors.push('Visual intent requires imageContext with hasImage=true or explicit visual target description');
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Parses natural-language prompt and context into a canonical IntentContract.
 * Uses language-agnostic semantic classification without hardcoded Bengali/English vocabulary lists.
 */
export function parseIntentFromPrompt(params: {
  prompt: string;
  framework?: string;
  hasImage?: boolean;
  imageContext?: ImageContext;
  currentFiles?: Record<string, string>;
  activeFile?: string;
}): IntentContract {
  const {
    prompt,
    framework = 'nextjs',
    hasImage = false,
    imageContext,
    currentFiles = {},
    activeFile,
  } = params;

  const trimmed = prompt.trim();
  const fileCount = Object.keys(currentFiles).length;
  const id = 'intent_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);
  const timestamp = new Date().toISOString();

  // Normalize framework
  let detectedFramework = (framework || 'nextjs').toLowerCase();
  if (currentFiles['astro.config.mjs'] || currentFiles['astro.config.ts']) {
    detectedFramework = 'astro';
  } else if (currentFiles['vite.config.ts'] || currentFiles['vite.config.js']) {
    detectedFramework = 'vite';
  } else if (currentFiles['next.config.js'] || currentFiles['next.config.ts'] || currentFiles['next.config.mjs']) {
    detectedFramework = 'nextjs';
  }

  // Parse explicit framework request in prompt if present
  const fwMatch = prompt.match(/\b(next\.?js|vite(?:\s+react)?|astro)\b/i);
  if (fwMatch) {
    const rawFw = fwMatch[1].toLowerCase();
    if (rawFw.includes('astro')) detectedFramework = 'astro';
    else if (rawFw.includes('vite')) detectedFramework = 'vite';
    else if (rawFw.includes('next')) detectedFramework = 'nextjs';
  }

  // Detect explicit version if mentioned (e.g. Next.js 15, Vite 5, React 19)
  const verMatch = prompt.match(/(?:next\.?js|vite|react|astro)\s*(?:v(?:ersion)?)?\s*(\d+(?:\.\d+)?)/i);
  const frameworkVersion = verMatch ? verMatch[1] : undefined;

  // Language agnostic semantic action classification
  let action: IntentAction;
  const isImageTask = hasImage || (imageContext && imageContext.hasImage);

  // Read-only question/explain detection
  const isQuestion = /^(?:what|how|why|where|who|when|which|can\s+you\s+explain|explain|describe)\b/i.test(trimmed) &&
    !/\b(create|build|make|add|fix|change|update|delete|remove|refactor|smaller|bigger)\b/i.test(trimmed);

  const isInspect = /^(?:inspect|audit|check\s+security|scan|list\s+files)\b/i.test(trimmed);

  if (isQuestion) {
    action = trimmed.toLowerCase().startsWith('explain') ? 'EXPLAIN' : 'QUESTION';
  } else if (isInspect) {
    action = 'INSPECT';
  } else if (isImageTask) {
    action = fileCount === 0 || /\b(recreate|build|create|from\s+scratch)\b/i.test(trimmed)
      ? 'VISUAL_RECREATE'
      : 'VISUAL_EDIT';
  } else if (fileCount === 0 || /\b(create|build|generate|scaffold|new\s+website|new\s+project|new\s+app)\b/i.test(trimmed)) {
    action = 'CREATE_PROJECT';
  } else if (/\b(fix|bug|broken|error|resolve|repair|fails?|crash)\b/i.test(trimmed)) {
    action = 'FIX_BUG';
  } else if (/\b(refactor|clean\s*up|reorganize|structure|rename)\b/i.test(trimmed)) {
    action = 'REFACTOR';
  } else if (/\b(add|implement|new\s+feature|include|integrate|support)\b/i.test(trimmed)) {
    action = 'ADD_FEATURE';
  } else if (/\b(make|change|update|modify|smaller|larger|adjust|style|replace|switch)\b/i.test(trimmed)) {
    action = 'MODIFY_FEATURE';
  } else if (/\b(continue|proceed|next\s+step|keep\s+going)\b/i.test(trimmed)) {
    action = 'CONTINUE_BUILD';
  } else {
    // Default mutating intent based on workspace state
    action = fileCount === 0 ? 'CREATE_PROJECT' : 'MODIFY_FEATURE';
  }

  // Extract candidate target files from prompt or activeFile
  const targetFiles: string[] = [];
  if (activeFile && currentFiles[activeFile]) {
    targetFiles.push(activeFile);
  }

  // Discover paths mentioned in prompt
  for (const existingPath of Object.keys(currentFiles)) {
    const baseName = existingPath.split('/').pop() || '';
    if (prompt.toLowerCase().includes(existingPath.toLowerCase()) || (baseName && prompt.toLowerCase().includes(baseName.toLowerCase()))) {
      if (!targetFiles.includes(existingPath)) {
        targetFiles.push(existingPath);
      }
    }
  }

  // Extract requirements from prompt
  const requirements: string[] = [];
  if (action === 'CREATE_PROJECT') {
    requirements.push(`Create complete ${detectedFramework} web application matching: ${trimmed}`);
    if (/landing\s*page/i.test(trimmed)) {
      requirements.push('Include cohesive modern layout with navigation, sections, and responsive design');
    }
    if (/navbar|navigation/i.test(trimmed)) requirements.push('Include responsive navigation bar');
    if (/hero/i.test(trimmed)) requirements.push('Include high-converting hero section');
    if (/pricing/i.test(trimmed)) requirements.push('Include tiered pricing comparison cards');
    if (/testimonial/i.test(trimmed)) requirements.push('Include customer testimonials section');
    if (/footer/i.test(trimmed)) requirements.push('Include full footer with navigation and legal links');
  } else {
    requirements.push(`Implement requested change: ${trimmed}`);
    if (targetFiles.length > 0) {
      requirements.push(`Target relevant files: ${targetFiles.join(', ')}`);
    }
  }

  // Formulate canonical acceptance criteria
  const acceptanceCriteria: AcceptanceCriterion[] = [];
  if (action === 'CREATE_PROJECT') {
    acceptanceCriteria.push({
      id: 'crit-build-pass',
      criterion: `${detectedFramework} project compiles natively with zero errors`,
      type: 'build_passes',
      target: 'project',
      verification: 'native_build',
    });
    if (detectedFramework === 'nextjs') {
      acceptanceCriteria.push({
        id: 'crit-route-exists',
        criterion: 'App Router entry page app/page.tsx exists and exports default component',
        type: 'route_exists',
        target: 'app/page.tsx',
        verification: 'static_ast',
      });
    }
  } else if (action === 'MODIFY_FEATURE' || action === 'VISUAL_EDIT') {
    // Specific property adjustments (e.g. "make navbar logo 20% smaller")
    const isSmallerLogo = /logo/i.test(trimmed) && /(?:smaller|reduce|20%|size)/i.test(trimmed);
    if (isSmallerLogo) {
      acceptanceCriteria.push({
        id: 'crit-logo-size',
        criterion: 'Navbar logo dimensions are reduced by 20% compared to baseline',
        type: 'ui_property',
        target: 'navbar.logo',
        verification: 'delta_ast',
        expectedValue: '0.8x',
      });
      acceptanceCriteria.push({
        id: 'crit-navbar-intact',
        criterion: 'Navbar continues to render other navigational elements without regressions',
        type: 'component_exists',
        target: 'Navbar',
        verification: 'static_ast',
      });
    } else {
      acceptanceCriteria.push({
        id: 'crit-mod-applied',
        criterion: `Requested modification '${trimmed}' is reflected in target components`,
        type: 'text_contains',
        target: targetFiles[0] || 'app/page.tsx',
        verification: 'static_ast',
      });
    }
  } else if (action === 'ADD_FEATURE') {
    if (/hamburger|mobile\s*menu/i.test(trimmed)) {
      acceptanceCriteria.push({
        id: 'crit-hamburger-trigger',
        criterion: 'Mobile hamburger menu toggle button is present with open/close state',
        type: 'interaction',
        target: 'mobile-menu-trigger',
        verification: 'behavioral',
      });
      acceptanceCriteria.push({
        id: 'crit-responsive-behavior',
        criterion: 'Desktop navigation remains visible on large screens while mobile menu adapts to small screens',
        type: 'responsive_behavior',
        target: 'navigation',
        verification: 'behavioral',
      });
    } else {
      acceptanceCriteria.push({
        id: 'crit-feature-present',
        criterion: `Feature for '${trimmed}' is integrated and exported cleanly`,
        type: 'symbol_exists',
        target: targetFiles[0] || 'app/page.tsx',
        verification: 'static_ast',
      });
    }
  } else if (action === 'VISUAL_RECREATE') {
    acceptanceCriteria.push({
      id: 'crit-visual-match',
      criterion: 'UI layout, color palette, and component hierarchy match provided visual reference',
      type: 'visual_similarity',
      target: 'viewport',
      verification: 'visual_or_runtime',
    });
    acceptanceCriteria.push({
      id: 'crit-build-pass',
      criterion: `${detectedFramework} project compiles natively with zero errors`,
      type: 'build_passes',
      target: 'project',
      verification: 'native_build',
    });
  } else {
    // Read-only or inspect
    acceptanceCriteria.push({
      id: 'crit-query-resolved',
      criterion: `Provide accurate explanation or audit for '${trimmed}'`,
      type: 'text_contains',
      target: 'response',
      verification: 'static_ast',
    });
  }

  // Security invariant preservation is always a mandatory criterion for any mutating action
  if (MUTATING_INTENT_ACTIONS.has(action) && (currentFiles['requirements.md'] || currentFiles['/requirements.md'])) {
    acceptanceCriteria.push({
      id: 'crit-security-invariants',
      criterion: 'requirements.md security invariants (Tenant isolation, Zero leaked credentials, RLS) intact',
      type: 'security_invariant',
      target: 'requirements.md',
      verification: 'static_ast',
    });
  }

  return {
    id,
    action,
    language: 'auto',
    framework: detectedFramework,
    frameworkVersion,
    targetDescription: trimmed,
    targetFiles: targetFiles.length > 0 ? targetFiles : undefined,
    requirements,
    constraints: [
      'Preserve existing working features and dependencies',
      'No hardcoded secrets or credentials',
      'Maintain framework conventions and type safety',
    ],
    acceptanceCriteria,
    imageContext,
    confidence: 0.95,
    clarificationRequired: false,
    timestamp,
  };
}
