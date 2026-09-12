import { Skill } from './types';

/**
 * Curated AI Skills Catalog for Opendrok Web Builder
 * Easily customizable and extensible for agentic workflows.
 */
export const SKILLS_CATALOG: Skill[] = [
  {
    id: 'codebase-design',
    name: 'codebase-design',
    title: 'Codebase Design & Deep Modules',
    description: 'Enforces modular architecture, deep modules, custom hooks, and prevents 1000-line monolithic files.',
    category: 'engineering',
    tags: ['architecture', 'deep-modules', 'clean-code', 'modularity'],
    defaultActiveInModes: ['build', 'edit'],
    promptContent: "# Codebase Design: Deep Modules & Clean Architecture\n\nDesign **deep modules**: a lot of behavior behind a small interface, placed at clean seams.\nUse this discipline to avoid monolithic, hard-to-maintain files.\n\n## 1. Deep vs Shallow Modules\n- **Deep Module** (Preferred): A small, clean interface with rich internal implementation (e.g. a custom hook useTradingStore() or an encapsulated component OrderBook).\n- **Shallow Module** (Avoid): A bloated interface that merely passes through props without hiding complexity, or a giant monolithic component where data fetching, state, calculations, and 20 nested sub-views live in one single 1000-line file.\n\n## 2. Component & File Separation Rules\n1. **Separate Business Logic from Presentation**:\n   - Extract state machines, calculations, and data fetching into custom hooks (e.g., hooks/use-trade.ts, lib/store.ts).\n   - Keep React components focused on layout, UI feedback, and user interaction.\n2. **Atomic Component Decomposition**:\n   - Break large pages into subcomponents under components/<feature>/ (e.g., Navbar.tsx, Sidebar.tsx, MetricCard.tsx).\n   - Each component should receive only the props it actually needs.\n3. **The Deletion Test**:\n   - If deleting a module merely moves messy complexity into 10 caller components, the module was not properly designed. A good module cleanly encapsulates its domain.\n4. **Locality & Seams**:\n   - State and logic that change together should live together.\n   - Avoid prop drilling through many levels; use lightweight React Context or custom hooks where appropriate."
  },
  {
    id: 'domain-modeling',
    name: 'domain-modeling',
    title: 'Domain Modeling & Type Discipline',
    description: 'Establishes canonical TypeScript interfaces and DB schema alignment before UI generation.',
    category: 'engineering',
    tags: ['typescript', 'database', 'schemas', 'domain-types'],
    defaultActiveInModes: ['build'],
    promptContent: "# Domain Modeling: Data & Type Discipline\n\nActively model the domain entities, types, and relationships before writing UI or state logic.\n\n## 1. Canonical Type Definitions\n- Create dedicated type definitions in types/ (e.g. types/crypto.ts, types/ecommerce.ts).\n- Define exact interfaces for every core entity:\n  - User / Account\n  - Core Business Entities (e.g. Position, Order, Product, Transaction)\n  - Enums for statuses (e.g. status: 'open' | 'closed' | 'pending')\n\n## 2. Naming Consistency\n- Avoid fuzzy or overloaded terms.\n- Use consistent property naming across API routes, database schemas, mock data, and UI components (e.g. choose createdAt or created_at consistently, never mix both for the same entity).\n\n## 3. Database Schema Alignment\n- When generating Supabase or SQL schemas, table columns, constraints, foreign keys, and RLS policies must strictly match the TypeScript interfaces.\n- Always generate companion supabase/schema.sql and supabase/seed.sql with realistic sample records."
  },
  {
    id: 'diagnosing-bugs',
    name: 'diagnosing-bugs',
    title: 'Diagnosing Bugs & Auto-Fix Discipline',
    description: 'Systematic root-cause diagnosis, error isolation, and minimal surgical fix without breaking other code.',
    category: 'engineering',
    tags: ['debugging', 'auto-fix', 'self-healing', 'diagnostics'],
    defaultActiveInModes: ['auto-fix'],
    promptContent: "# Diagnosing Bugs & Auto-Fix Discipline\n\nA disciplined diagnosis and self-healing loop for runtime errors, compilation bugs, and broken preview sandboxes.\n\n## Phase 1: Analyze the Error Signal\n- Examine the exact error message, stack trace, and line numbers.\n- Pinpoint the exact failure category:\n  - **Syntax Error** (unclosed JSX tag, unexpected token).\n  - **Missing / Invalid Import** (importing a non-existent file or wrong named export).\n  - **Type or Undefined Error** (e.g., Cannot read property of undefined).\n  - **Hydration / SSR Mismatch** (window is not defined, date/time differences).\n\n## Phase 2: Reproduce & Isolate the Seam\n- Locate the specific file and function responsible for the failure.\n- Do NOT jump to random rewrites. Isolate the minimal breaking code hunk.\n\n## Phase 3: Rank Hypotheses\n- State the most probable root cause before editing.\n- Ensure the proposed change addresses the core issue without altering unrelated working functionality.\n\n## Phase 4: Surgical Fix\n- Apply minimal, precise edits to resolve the error.\n- **NEVER delete working components, features, or state** to silence an error.\n- Ensure all required dependencies exist in package.json.\n- If a missing component was imported, create that component with full implementation.\n\n## Phase 5: Verify & Clean\n- Ensure the fix passes syntax and type checks.\n- Keep other files intact and verify that the preview can compile cleanly."
  },
  {
    id: 'prototype',
    name: 'prototype',
    title: 'Rapid Prototyping & Interactive UI',
    description: 'Quick throwaway UI variations, state walkthroughs, and realistic mock data simulation.',
    category: 'engineering',
    tags: ['ui', 'prototype', 'mock-data', 'interactivity'],
    defaultActiveInModes: ['build'],
    promptContent: "# Prototype: Rapid UI & Logic Exploration\n\nBuild fast, functional prototypes that immediately answer user questions and demonstrate concepts.\n\n## 1. UI Exploration\n- Create interactive, visually stunning UI mockups with realistic mock data.\n- Surface all primary actions (buttons, modals, drawers, tabs, filters) with real React state.\n- Include responsive layouts (mobile, tablet, desktop) using Tailwind CSS.\n\n## 2. Logic Exploration\n- When demonstrating state machines (e.g. trading simulator calculations, checkout flows, multi-step wizards), make the state visible.\n- Add feedback badges or status indicators so the user can see state changes in real time.\n\n## 3. Zero Boilerplate Drag\n- Use in-memory state or localStorage for rapid client-side prototyping before hooking up full backend storage.\n- Provide sensible defaults and realistic sample data out of the box."
  },
  {
    id: 'grilling',
    name: 'grilling',
    title: 'Requirements Grilling & Alignment',
    description: 'Interviews user in structured rounds to eliminate assumptions when requirements are vague.',
    category: 'productivity',
    tags: ['interview', 'requirements', 'clarification'],
    defaultActiveInModes: ['chat'],
    promptContent: "# Grilling: Relentless Requirements Alignment\n\nInterview the user in structured rounds to eliminate assumptions and clarify ambiguous requirements before building.\n\n## 1. The Design Tree\n- Every product decision branches into dependent decisions.\n- Formulate high-leverage questions that resolve the root architectural decisions first.\n\n## 2. Round-Based Questions\nWhen requirements are vague, present questions in structured rounds:\n- **Q1**: Specific question with clear multiple-choice options.\n- **Recommendation**: Provide the best technical recommendation clearly.\n\n## 3. Scope & Constraints\n- Clarify target audience, core features, auth requirements, and theme preferences.\n- Once requirements are confirmed, immediately transition to building without asking redundant questions."
  },
  {
    id: 'code-review',
    name: 'code-review',
    title: 'Code Review & Standards Audit',
    description: 'Two-axis review: Standards (TypeScript, Tailwind, code smells) + Spec adherence.',
    category: 'architecture',
    tags: ['review', 'audit', 'code-quality', 'refactor'],
    defaultActiveInModes: [],
    promptContent: "# Code Review: Standards & Spec Audit\n\nAudit code along two independent axes: **Standards** and **Spec Adherence**.\n\n## 1. Standards Axis\nCheck code quality against modern fullstack best practices:\n- **TypeScript**: No any types, properly typed props and return types.\n- **Component Hygiene**: No monolithic 1000-line components, business logic extracted into hooks.\n- **Tailwind & UI**: Consistent spacing, accessible contrast, mobile responsiveness.\n- **Code Smells**: Identify duplicate code, mystery variable names, prop drilling, and dead code.\n\n## 2. Spec Axis\nVerify alignment with the user's prompt or requirements:\n- Check if all requested pages, components, and interactive features are present.\n- Identify any missing edge cases or incomplete implementations (e.g. missing modals, incomplete forms).\n- Highlight any unintended scope creep or unnecessary dependencies."
  }
];

export function getAllSkills(): Skill[] {
  return SKILLS_CATALOG;
}

export function getSkillById(id: string): Skill | undefined {
  return SKILLS_CATALOG.find((s) => s.id === id);
}

export function getSkillsForMode(mode: 'build' | 'auto-fix' | 'visual-fix' | 'chat' | 'edit'): Skill[] {
  return SKILLS_CATALOG.filter((s) => s.defaultActiveInModes?.includes(mode));
}

export function renderSkillsPrompt(selectedSkillIds?: string[], mode?: 'build' | 'auto-fix' | 'visual-fix' | 'chat' | 'edit'): string {
  let skillsToRender: Skill[] = [];

  if (selectedSkillIds && selectedSkillIds.length > 0) {
    skillsToRender = selectedSkillIds
      .map((id) => getSkillById(id))
      .filter((s): s is Skill => Boolean(s));
  } else if (mode) {
    skillsToRender = getSkillsForMode(mode);
  }

  if (skillsToRender.length === 0) return '';

  const rendered = skillsToRender
    .map((skill) => '#### ' + skill.title + '\n' + skill.promptContent)
    .join('\n\n');

  return '\n### 🧠 ACTIVE ENGINEERING SKILLS & PRACTICES:\n' + rendered + '\n';
}
