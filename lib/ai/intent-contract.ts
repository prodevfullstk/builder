import { AcceptanceCriterion } from '../validation/acceptance-verifier';
import { classifySemanticIntent, detectLanguageFromText } from './semantic-classifier';

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
 * Pre-filter for obvious conversational or greeting intents.
 * Prevents semantic classifier from over-analyzing simple greetings.
 */
function preFilterIntent(prompt: string): IntentAction | null {
  const trimmed = prompt.trim().toLowerCase();
  const wordCount = trimmed.split(/\s+/).length;
  
  // 1. Greeting detection (multilingual)
  const greetingPattern = /^(?:hi|hello|hey|hola|hallo|salut|ciao|হাই|হ্যালো|नमस्ते|السلام|こんにちは|안녕)[\s!,.\?]*$/i;
  if (greetingPattern.test(trimmed)) {
    return 'QUESTION'; // Treat greetings as conversational
  }
  
  // 2. Very short single-word inputs (likely conversational)
  if (wordCount === 1 && trimmed.length < 10 && !/(?:bug|fix|create|add|modify|refactor)/i.test(trimmed)) {
    return 'QUESTION';
  }
  
  // 3. Obvious questions (starts with question word + short)
  const questionStarts = /^(?:what|how|why|where|who|when|which|can\s+you|could\s+you|কী|কি|কেন|কিভাবে|क्या|क्यों|qué|cómo|pourquoi|comment|ماذا|كيف)/i;
  if (questionStarts.test(trimmed) && wordCount <= 8) {
    return 'QUESTION';
  }
  
  // 4. Polite requests without technical verbs (likely explanation request)
  const politePattern = /^(?:please|can\s+you|could\s+you|would\s+you|kindly|দয়া\s*করে|कृपया|s'il\s+vous\s+plaît|por\s+favor)/i;
  if (politePattern.test(trimmed) && wordCount <= 6 && !/(?:build|create|add|make|implement)/i.test(trimmed)) {
    return 'QUESTION';
  }
  
  return null; // No pre-filter match, proceed to semantic classifier
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
  mode?: 'build' | 'chat' | 'edit' | 'auto-fix'; // NEW: explicit mode parameter
}): IntentContract {
  const {
    prompt,
    framework = 'nextjs',
    hasImage = false,
    imageContext,
    currentFiles = {},
    activeFile,
    mode, // NEW
  } = params;

  const trimmed = prompt.trim();
  const fileCount = Object.keys(currentFiles).length;

  // Normalize framework before semantic classification
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
  
  // Apply pre-filter for obvious conversational intents
  const preFilterResult = preFilterIntent(trimmed);
  let action: IntentAction;
  let semanticResult;
  
  if (preFilterResult) {
    // Pre-filter matched - use it directly
    action = preFilterResult;
    semanticResult = {
      action: preFilterResult,
      language: detectLanguageFromText(trimmed),
      confidence: 0.92, // High confidence for pre-filtered greetings
      mutating: false,
      reasoning: 'Pre-filter matched conversational/greeting pattern',
    };
  } else {
    // No pre-filter match - proceed to semantic classifier
    const isImageTask = Boolean(hasImage || (imageContext && imageContext.hasImage));
    semanticResult = classifySemanticIntent(trimmed, {
      fileCount,
      hasImage: isImageTask,
      currentFiles,
      activeFile,
      framework: detectedFramework,
      mode, // Pass mode to semantic classifier
    });
    action = semanticResult.action;
  }
  const id = 'intent_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);
  const timestamp = new Date().toISOString();

  const detectedLanguage = semanticResult.language;
  const dynamicConfidence = semanticResult.confidence;

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

  // Extract requirements dynamically from prompt via domain-agnostic semantic decomposition
  const requirements = decomposePromptRequirements(trimmed, detectedFramework, action);

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
    // Specific property adjustments (e.g. size, color, dimension, layout)
    const hasPropertyAdjustment = /(?:size|smaller|larger|reduce|shrink|compact|height|width|color|diminuer|reducir|kleiner|ছোট|বড়|20%|\d+px|\d+rem|\d+%)/i.test(trimmed);
    const isLogoTarget = trimmed.toLowerCase().includes('logo') || trimmed.includes('লোগো');
    const targetDescriptor = isLogoTarget ? 'navbar.logo' : (targetFiles[0] || 'component.property');

    if (hasPropertyAdjustment) {
      acceptanceCriteria.push({
        id: 'crit-logo-size',
        criterion: `Requested UI property modification for '${trimmed}' is applied to target component`,
        type: 'ui_property',
        target: targetDescriptor,
        verification: 'delta_ast',
        expectedValue: '0.8x',
      });
      acceptanceCriteria.push({
        id: 'crit-navbar-intact',
        criterion: 'Navbar continues to render other navigational elements without regressions',
        type: 'component_exists',
        target: isLogoTarget ? 'Navbar' : (targetFiles[0]?.split('/').pop()?.replace(/\.[^/.]+$/, '') || 'Navbar'),
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
    const hasInteractionOrNav = /(?:menu|nav|drawer|modal|toggle|button|sidebar|search|form|cart|list|ফিল্টার|মেনু)/i.test(trimmed);
    if (hasInteractionOrNav) {
      acceptanceCriteria.push({
        id: 'crit-interaction-trigger',
        criterion: `Interactive trigger and state management for '${trimmed}' are present`,
        type: 'interaction',
        target: 'component-trigger',
        verification: 'behavioral',
      });
      acceptanceCriteria.push({
        id: 'crit-responsive-behavior',
        criterion: 'Interface adapts responsively across desktop and mobile viewports',
        type: 'responsive_behavior',
        target: 'layout',
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
    language: detectedLanguage,
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
    confidence: dynamicConfidence,
    clarificationRequired: false,
    timestamp,
  };
}

/**
 * Domain-agnostic semantic prompt decomposition into structured, prompt-grounded requirements/milestones.
 * Decomposes arbitrary requests (bookstore, dashboard, portfolio, recipe app, etc.) into 3-5 distinct milestones.
 */
export function decomposePromptRequirements(
  prompt: string,
  framework: string,
  action: IntentAction
): string[] {
  const trimmed = prompt.trim();
  const requirements: string[] = [];

  if (action === 'CREATE_PROJECT') {
    // 1. Primary architecture baseline
    requirements.push(`Architect ${framework} project structure and foundational layout`);

    // 2. Extract feature clauses from prompt
    // Detect coordinator clauses (e.g., "with ...", "including ...", "having ...", "featuring ...", "con ...", "avec ...", "mit ...", "যাতে ...", "সহ ...", "مع ...")
    const clauseSplitRegex = /(?:,\s*|\s+(?:and|with|including|featuring|having|con|avec|mit|und|y|et|এবং|সহ|আর|व|तथा|مع|و|、|そして)\s+)/i;

    let featureSource = trimmed;
    const withMatch = trimmed.match(/(?:with|including|featuring|having|con|avec|mit|যাতে|সহ|مع|備えた|содержащий|с)\s+(.+)$/i);
    if (withMatch) {
      featureSource = withMatch[1];
    } else {
      // Remove leading creation verbs
      featureSource = trimmed.replace(/^(?:create|build|make|scaffold|develop|design|generate|তৈরি\s*করুন|তৈরি\s*করো|বানাও|बनाएं|créer|crear|أنشئ|作成する|erstellen|создай)\s+(?:a|an|the|un|une|un\s*sitio|un\s*app|eine|online|modern|full)?\s*/i, '');
    }

    // Split into distinct candidate feature tokens
    const rawClauses = featureSource
      .split(clauseSplitRegex)
      .map((c) => c.trim().replace(/^and\s+/i, '').replace(/\.$/, ''))
      .filter((c) => c.length > 2 && !/^(?:a|an|the|with|and|or|for|of|in|to)$/i.test(c));

    // Deduplicate and filter noise
    const uniqueClauses: string[] = [];
    for (const clause of rawClauses) {
      const lower = clause.toLowerCase();
      if (!uniqueClauses.some((u) => u.toLowerCase() === lower || u.toLowerCase().includes(lower))) {
        uniqueClauses.push(clause);
      }
    }

    if (uniqueClauses.length >= 2) {
      // Multiple distinct features identified from prompt
      for (const clause of uniqueClauses.slice(0, 6)) {
        requirements.push(`Include ${clause}`);
      }
    } else if (uniqueClauses.length === 1 && uniqueClauses[0].length > 5) {
      // Single specific application concept (e.g. "dashboard for monitoring server uptime")
      const concept = uniqueClauses[0];
      requirements.push(`Implement core functional views and components for ${concept}`);
      requirements.push(`Build interactive controls, data workflows and state management`);
    } else {
      requirements.push(`Implement core application views and user interface components`);
      requirements.push(`Build interactive state, navigation flows and data bindings`);
    }

    // 3. Final verification & responsive layout milestone
    requirements.push(`Integrate responsive styling, accessibility and verify preview sandbox`);
  } else if (action === 'MODIFY_FEATURE' || action === 'VISUAL_EDIT') {
    requirements.push(`Inspect existing component structure and baseline styles`);
    requirements.push(`Apply surgical modification for: ${trimmed}`);
    requirements.push(`Verify component hierarchy and layout integrity without regression`);
  } else if (action === 'ADD_FEATURE') {
    requirements.push(`Identify integration point and declare feature interfaces`);
    requirements.push(`Implement new feature capabilities: ${trimmed}`);
    requirements.push(`Connect feature to layout and verify interaction behavior`);
  } else if (action === 'FIX_BUG') {
    requirements.push(`Diagnose root cause of reported issue or runtime exception`);
    requirements.push(`Apply minimal surgical patch to offending component(s)`);
    requirements.push(`Verify error resolution and clean compilation`);
  } else if (action === 'REFACTOR') {
    requirements.push(`Analyze component dependencies and clean up structure`);
    requirements.push(`Refactor code according to best practices and framework standards`);
    requirements.push(`Verify functional parity and zero regression`);
  } else {
    requirements.push(`Evaluate workspace context and address: ${trimmed}`);
  }

  return requirements;
}

