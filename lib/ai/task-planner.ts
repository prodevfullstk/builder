/**
 * Task Decomposition & Planning Engine
 * Breaks complex intents into executable subtasks with dependencies
 * 
 * This is the "brain" that decides HOW to execute a complex request by:
 * 1. Analyzing the intent and requirements
 * 2. Breaking it into logical subtasks
 * 3. Determining dependencies and parallel execution opportunities
 * 4. Assigning appropriate skills to each subtask
 */

import { IntentContract, MUTATING_INTENT_ACTIONS } from './intent-contract';

export interface ExecutionSubtask {
  id: string;
  type: 'generate' | 'edit' | 'validate' | 'integrate';
  description: string;
  targetFiles: string[];
  dependencies: string[]; // IDs of subtasks that must complete first
  skillsRequired: string[]; // Which skills to activate for this subtask
  estimatedTokens: number;
  priority: number; // 1 (highest) to 5 (lowest)
}

export interface ExecutionPlan {
  id: string;
  intent: IntentContract;
  subtasks: ExecutionSubtask[];
  parallelGroups: string[][]; // Which subtasks can run in parallel
  estimatedDuration: number; // milliseconds
  requiresValidation: boolean;
  metadata: {
    complexity: 'simple' | 'medium' | 'high' | 'very_high';
    estimatedFiles: number;
    hasDatabase: boolean;
    hasAuth: boolean;
  };
}

/**
 * Main planning function - decomposes an intent into an execution plan
 */
export function planExecution(intent: IntentContract): ExecutionPlan {
  const planId = `plan_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
  const subtasks: ExecutionSubtask[] = [];
  
  // Determine complexity
  const complexity = assessComplexity(intent);
  const estimatedFiles = estimateFileCount(intent);
  
  // Generate subtasks based on intent action
  if (intent.action === 'CREATE_PROJECT') {
    subtasks.push(...generateProjectCreationTasks(intent, estimatedFiles));
  } else if (intent.action === 'ADD_FEATURE') {
    subtasks.push(...generateFeatureAdditionTasks(intent));
  } else if (intent.action === 'MODIFY_FEATURE' || intent.action === 'VISUAL_EDIT') {
    subtasks.push(...generateModificationTasks(intent));
  } else if (intent.action === 'FIX_BUG') {
    subtasks.push(...generateBugFixTasks(intent));
  } else if (intent.action === 'REFACTOR') {
    subtasks.push(...generateRefactorTasks(intent));
  } else {
    // Fallback for unknown actions - single task
    subtasks.push({
      id: 'task-1-execute',
      type: 'generate',
      description: intent.targetDescription,
      targetFiles: intent.targetFiles || [],
      dependencies: [],
      skillsRequired: [],
      estimatedTokens: 3000,
      priority: 1,
    });
  }
  
  // Determine parallel execution groups
  const parallelGroups = computeParallelGroups(subtasks);
  
  // Calculate estimated duration (rough heuristic)
  const estimatedDuration = subtasks.reduce((sum, task) => sum + (task.estimatedTokens * 0.05), 0);
  
  return {
    id: planId,
    intent,
    subtasks,
    parallelGroups,
    estimatedDuration,
    requiresValidation: intent.acceptanceCriteria.length > 0,
    metadata: {
      complexity,
      estimatedFiles,
      hasDatabase: intent.requirements.some(r => /database|db|sql|postgres|supabase/i.test(r)),
      hasAuth: intent.requirements.some(r => /auth|login|user|session/i.test(r)),
    },
  };
}

/**
 * Assess intent complexity based on requirements and targets
 */
function assessComplexity(intent: IntentContract): 'simple' | 'medium' | 'high' | 'very_high' {
  const fileCount = intent.targetFiles?.length || 0;
  const requirementCount = intent.requirements.length;
  const criteriaCount = intent.acceptanceCriteria.length;
  
  const score = fileCount * 2 + requirementCount + criteriaCount;
  
  if (score <= 5) return 'simple';
  if (score <= 10) return 'medium';
  if (score <= 20) return 'high';
  return 'very_high';
}

/**
 * Estimate number of files that will be generated
 */
function estimateFileCount(intent: IntentContract): number {
  if (intent.targetFiles && intent.targetFiles.length > 0) {
    return intent.targetFiles.length;
  }
  
  // Heuristic based on requirements
  const reqs = intent.requirements;
  let estimate = 0;
  
  // Base files for any project
  if (intent.action === 'CREATE_PROJECT') {
    estimate = 5; // package.json, page.tsx, layout.tsx, globals.css, types
    
    // Add for each unique component/page mentioned
    const componentMentions = reqs.filter(r => /component|card|button|modal|nav|header|footer/i.test(r)).length;
    estimate += componentMentions;
    
    // Add for features
    if (reqs.some(r => /auth|login/i.test(r))) estimate += 3;
    if (reqs.some(r => /database|db/i.test(r))) estimate += 2;
    if (reqs.some(r => /api|endpoint/i.test(r))) estimate += 2;
  }
  
  return Math.max(estimate, 3);
}

/**
 * Generate subtasks for project creation
 */
function generateProjectCreationTasks(intent: IntentContract, estimatedFiles: number): ExecutionSubtask[] {
  const tasks: ExecutionSubtask[] = [];
  let taskCounter = 1;
  
  // Task 1: Types & Domain Model (always first)
  tasks.push({
    id: `task-${taskCounter++}-types`,
    type: 'generate',
    description: 'Generate TypeScript type definitions and domain model',
    targetFiles: ['types/index.ts'],
    dependencies: [],
    skillsRequired: ['domain-modeling'],
    estimatedTokens: 1500,
    priority: 1,
  });
  
  // Task 2: Mock Data (depends on types)
  if (estimatedFiles > 3) {
    tasks.push({
      id: `task-${taskCounter++}-data`,
      type: 'generate',
      description: 'Generate realistic mock data and seed records',
      targetFiles: ['lib/data/mock-data.ts'],
      dependencies: ['task-1-types'],
      skillsRequired: ['prototype'],
      estimatedTokens: 2000,
      priority: 2,
    });
  }
  
  // Task 3: Utility Functions
  tasks.push({
    id: `task-${taskCounter++}-utils`,
    type: 'generate',
    description: 'Generate utility functions and helpers',
    targetFiles: ['lib/utils.ts'],
    dependencies: [],
    skillsRequired: [],
    estimatedTokens: 800,
    priority: 3,
  });
  
  // Task 4: Components (parallel, depends on types)
  const componentRequirements = intent.requirements.filter(r => 
    /component|navbar|hero|footer|card|button|modal|form/i.test(r)
  );
  
  if (componentRequirements.length > 0) {
    const componentFiles = deduceComponentFiles(intent);
    
    tasks.push({
      id: `task-${taskCounter++}-components`,
      type: 'generate',
      description: 'Generate UI components and interactive elements',
      targetFiles: componentFiles,
      dependencies: ['task-1-types'],
      skillsRequired: ['codebase-design', 'prototype'],
      estimatedTokens: Math.min(componentFiles.length * 800, 5000),
      priority: 2,
    });
  }
  
  // Task 5: Database Schema (if needed)
  if (intent.requirements.some(r => /database|db|supabase|postgres|sql/i.test(r))) {
    tasks.push({
      id: `task-${taskCounter++}-database`,
      type: 'generate',
      description: 'Generate database schema and migrations',
      targetFiles: ['supabase/schema.sql', 'supabase/seed.sql'],
      dependencies: ['task-1-types'],
      skillsRequired: ['domain-modeling'],
      estimatedTokens: 2000,
      priority: 2,
    });
  }
  
  // Task 6: API Routes (if needed)
  if (intent.requirements.some(r => /api|endpoint|route|backend/i.test(r))) {
    tasks.push({
      id: `task-${taskCounter++}-api`,
      type: 'generate',
      description: 'Generate API routes and handlers',
      targetFiles: ['app/api/*/route.ts'],
      dependencies: ['task-1-types'],
      skillsRequired: [],
      estimatedTokens: 2500,
      priority: 2,
    });
  }
  
  // Task 7: Pages (depends on components)
  const pageFiles = deducePageFiles(intent);
  const componentDependency = tasks.find(t => t.id.includes('components'));
  
  tasks.push({
    id: `task-${taskCounter++}-pages`,
    type: 'integrate',
    description: 'Generate page composition and routing',
    targetFiles: pageFiles,
    dependencies: componentDependency ? [componentDependency.id] : ['task-1-types'],
    skillsRequired: ['codebase-design'],
    estimatedTokens: pageFiles.length * 1000,
    priority: 3,
  });
  
  // Task 8: Config & Package
  tasks.push({
    id: `task-${taskCounter++}-config`,
    type: 'generate',
    description: 'Generate configuration files and dependencies',
    targetFiles: ['package.json', 'tsconfig.json', 'tailwind.config.ts', 'next.config.ts'],
    dependencies: [],
    skillsRequired: [],
    estimatedTokens: 1200,
    priority: 4,
  });
  
  return tasks;
}

/**
 * Generate subtasks for adding a new feature
 */
function generateFeatureAdditionTasks(intent: IntentContract): ExecutionSubtask[] {
  const tasks: ExecutionSubtask[] = [];
  
  // Task 1: Extend types if needed
  if (intent.requirements.some(r => /new.*type|interface|model/i.test(r))) {
    tasks.push({
      id: 'task-1-extend-types',
      type: 'edit',
      description: 'Extend type definitions for new feature',
      targetFiles: ['types/index.ts'],
      dependencies: [],
      skillsRequired: ['domain-modeling'],
      estimatedTokens: 1000,
      priority: 1,
    });
  }
  
  // Task 2: Generate new components
  const newComponentFiles = deduceComponentFiles(intent);
  if (newComponentFiles.length > 0) {
    tasks.push({
      id: 'task-2-new-components',
      type: 'generate',
      description: `Generate new feature components: ${intent.targetDescription}`,
      targetFiles: newComponentFiles,
      dependencies: tasks.length > 0 ? ['task-1-extend-types'] : [],
      skillsRequired: ['codebase-design', 'prototype'],
      estimatedTokens: newComponentFiles.length * 1200,
      priority: 1,
    });
  }
  
  // Task 3: Integrate into existing pages
  if (intent.targetFiles && intent.targetFiles.length > 0) {
    tasks.push({
      id: 'task-3-integration',
      type: 'edit',
      description: 'Integrate new feature into existing pages',
      targetFiles: intent.targetFiles,
      dependencies: tasks.length > 0 ? [tasks[tasks.length - 1].id] : [],
      skillsRequired: [],
      estimatedTokens: 1500,
      priority: 2,
    });
  }
  
  return tasks;
}

/**
 * Generate subtasks for modifications
 */
function generateModificationTasks(intent: IntentContract): ExecutionSubtask[] {
  const tasks: ExecutionSubtask[] = [];
  
  // Single surgical edit task
  tasks.push({
    id: 'task-1-modify',
    type: 'edit',
    description: intent.targetDescription,
    targetFiles: intent.targetFiles || [],
    dependencies: [],
    skillsRequired: intent.action === 'VISUAL_EDIT' ? ['prototype'] : [],
    estimatedTokens: 1500,
    priority: 1,
  });
  
  return tasks;
}

/**
 * Generate subtasks for bug fixes
 */
function generateBugFixTasks(intent: IntentContract): ExecutionSubtask[] {
  const tasks: ExecutionSubtask[] = [];
  
  // Task 1: Diagnose
  tasks.push({
    id: 'task-1-diagnose',
    type: 'validate',
    description: 'Analyze error and identify root cause',
    targetFiles: intent.targetFiles || [],
    dependencies: [],
    skillsRequired: ['diagnosing-bugs'],
    estimatedTokens: 800,
    priority: 1,
  });
  
  // Task 2: Apply fix
  tasks.push({
    id: 'task-2-fix',
    type: 'edit',
    description: 'Apply surgical fix to resolve bug',
    targetFiles: intent.targetFiles || [],
    dependencies: ['task-1-diagnose'],
    skillsRequired: ['diagnosing-bugs'],
    estimatedTokens: 1200,
    priority: 1,
  });
  
  return tasks;
}

/**
 * Generate subtasks for refactoring
 */
function generateRefactorTasks(intent: IntentContract): ExecutionSubtask[] {
  const tasks: ExecutionSubtask[] = [];
  
  // Task 1: Extract reusable code
  tasks.push({
    id: 'task-1-extract',
    type: 'generate',
    description: 'Extract reusable components/utilities',
    targetFiles: [],
    dependencies: [],
    skillsRequired: ['codebase-design'],
    estimatedTokens: 2000,
    priority: 1,
  });
  
  // Task 2: Update references
  tasks.push({
    id: 'task-2-update',
    type: 'edit',
    description: 'Update all references to use refactored code',
    targetFiles: intent.targetFiles || [],
    dependencies: ['task-1-extract'],
    skillsRequired: ['codebase-design'],
    estimatedTokens: 1500,
    priority: 2,
  });
  
  return tasks;
}

/**
 * Deduce component file paths from intent
 */
function deduceComponentFiles(intent: IntentContract): string[] {
  const files: string[] = [];
  const lower = intent.targetDescription.toLowerCase();
  
  // Common component patterns
  if (/navbar|nav|navigation|header/i.test(lower)) files.push('components/Navbar.tsx');
  if (/hero|landing/i.test(lower)) files.push('components/Hero.tsx');
  if (/footer/i.test(lower)) files.push('components/Footer.tsx');
  if (/card|product.*card/i.test(lower)) files.push('components/Card.tsx');
  if (/button/i.test(lower)) files.push('components/Button.tsx');
  if (/modal|dialog/i.test(lower)) files.push('components/Modal.tsx');
  if (/form/i.test(lower)) files.push('components/Form.tsx');
  if (/pricing|price.*table/i.test(lower)) files.push('components/Pricing.tsx');
  if (/chart|graph/i.test(lower)) files.push('components/Chart.tsx');
  if (/table|data.*table/i.test(lower)) files.push('components/Table.tsx');
  
  // Feature-specific components
  if (/dashboard/i.test(lower)) {
    files.push('components/dashboard/StatsCard.tsx');
    files.push('components/dashboard/MetricsChart.tsx');
  }
  
  if (/auth|login|signup/i.test(lower)) {
    files.push('components/auth/AuthModal.tsx');
    files.push('components/auth/LoginForm.tsx');
  }
  
  if (/shop|ecommerce|cart/i.test(lower)) {
    files.push('components/shop/ProductCard.tsx');
    files.push('components/shop/CartDrawer.tsx');
  }
  
  return files;
}

/**
 * Deduce page file paths from intent
 */
function deducePageFiles(intent: IntentContract): string[] {
  const files: string[] = ['app/page.tsx']; // Always include home page
  const lower = intent.targetDescription.toLowerCase();
  
  if (/dashboard/i.test(lower)) files.push('app/dashboard/page.tsx');
  if (/pricing/i.test(lower)) files.push('app/pricing/page.tsx');
  if (/about/i.test(lower)) files.push('app/about/page.tsx');
  if (/contact/i.test(lower)) files.push('app/contact/page.tsx');
  if (/shop|products/i.test(lower)) files.push('app/shop/page.tsx');
  if (/cart/i.test(lower)) files.push('app/cart/page.tsx');
  if (/profile/i.test(lower)) files.push('app/profile/page.tsx');
  
  return files;
}

/**
 * Compute which tasks can run in parallel
 */
function computeParallelGroups(subtasks: ExecutionSubtask[]): string[][] {
  const groups: string[][] = [];
  const completed = new Set<string>();
  
  while (completed.size < subtasks.length) {
    const ready = subtasks.filter(task => 
      !completed.has(task.id) &&
      task.dependencies.every(dep => completed.has(dep))
    );
    
    if (ready.length === 0) break; // Safety: avoid infinite loop
    
    groups.push(ready.map(t => t.id));
    ready.forEach(t => completed.add(t.id));
  }
  
  return groups;
}

/**
 * Utility: Check if intent needs orchestration
 */
export function shouldOrchestrate(intent: IntentContract): boolean {
  // Always orchestrate project creation
  if (intent.action === 'CREATE_PROJECT') {
    const estimatedFiles = estimateFileCount(intent);
    return estimatedFiles >= 5;
  }
  
  // Orchestrate complex features
  if (intent.action === 'ADD_FEATURE' || intent.action === 'REFACTOR') {
    return intent.requirements.length >= 3;
  }
  
  // Don't orchestrate simple edits
  if (intent.action === 'MODIFY_FEATURE' || intent.action === 'FIX_BUG') {
    return false;
  }
  
  // Default: no orchestration for simple tasks
  return false;
}
