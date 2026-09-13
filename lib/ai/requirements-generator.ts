/**
 * Project Requirements & Specification Generator
 *
 * Synthesizes a structured project specification from the user's initial prompt
 * and technical constraints, producing a persistent requirements.md artifact.
 */

import { ProjectSpec } from '@/lib/validation/types';
import { Framework } from '@/lib/store/project-store';

export function synthesizeProjectRequirements(
  prompt: string,
  framework: Framework = 'nextjs',
  dbProvider: string = 'none',
  authProvider: string = 'none'
): { spec: ProjectSpec; requirementsMarkdown: string } {
  const cleanPrompt = prompt.trim();
  const lower = cleanPrompt.toLowerCase();

  // Resolve default framework versions or parse explicit version from prompt
  let frameworkVersion = '^15.0.0';
  if (framework === 'vite' || (framework as string) === 'vite-react') {
    frameworkVersion = '^5.0.0';
  } else if (framework === 'astro') {
    frameworkVersion = '^4.0.0';
  } else if (framework === 'node') {
    frameworkVersion = '^20.0.0';
  }

  // Parse explicit framework versions requested in user prompt (P2-3)
  const nextMatch = cleanPrompt.match(/next(?:\.js)?\s*v?([0-9]+(?:\.[0-9]+)?)/i);
  if (framework === 'nextjs' && nextMatch) {
    frameworkVersion = nextMatch[1].includes('.') ? `^${nextMatch[1]}` : `^${nextMatch[1]}.0.0`;
  }
  const viteMatch = cleanPrompt.match(/vite\s*v?([0-9]+(?:\.[0-9]+)?)/i);
  if ((framework === 'vite' || (framework as string) === 'vite-react') && viteMatch) {
    frameworkVersion = viteMatch[1].includes('.') ? `^${viteMatch[1]}` : `^${viteMatch[1]}.0.0`;
  }
  const astroMatch = cleanPrompt.match(/astro\s*v?([0-9]+(?:\.[0-9]+)?)/i);
  if (framework === 'astro' && astroMatch) {
    frameworkVersion = astroMatch[1].includes('.') ? `^${astroMatch[1]}` : `^${astroMatch[1]}.0.0`;
  }
  const nodeMatch = cleanPrompt.match(/node(?:\.js)?\s*v?([0-9]+(?:\.[0-9]+)?)/i);
  if (framework === 'node' && nodeMatch) {
    frameworkVersion = nodeMatch[1].includes('.') ? `^${nodeMatch[1]}` : `^${nodeMatch[1]}.0.0`;
  }

  // Detect feature intents
  const hasAuth = authProvider !== 'none' || lower.includes('auth') || lower.includes('login') || lower.includes('signup') || lower.includes('user');
  const hasDb = dbProvider !== 'none' || lower.includes('db') || lower.includes('database') || lower.includes('crud') || lower.includes('store') || lower.includes('postgres') || lower.includes('sql');
  const hasEcommerce = lower.includes('shop') || lower.includes('ecommerce') || lower.includes('cart') || lower.includes('product') || lower.includes('billing') || lower.includes('stripe');
  const hasDashboard = lower.includes('dashboard') || lower.includes('analytics') || lower.includes('metrics') || lower.includes('saas');
  const isBangla = /[\u0980-\u09FF]/.test(cleanPrompt);

  // Derive pages & routes
  const pages: string[] = ['Home / Landing'];
  const routes: string[] = ['/'];

  if (hasDashboard) {
    pages.push('Dashboard', 'Analytics');
    routes.push('/dashboard', '/analytics');
  }
  if (hasEcommerce) {
    pages.push('Product Catalog', 'Shopping Cart', 'Checkout');
    routes.push('/products', '/cart', '/checkout');
  }
  if (hasAuth) {
    pages.push('Authentication / Sign In');
    routes.push('/login');
  }

  // Derive UI component hierarchy
  const components: string[] = ['Navbar', 'HeroSection', 'Footer'];
  if (hasDashboard) {
    components.push('StatsOverviewCard', 'MetricsChart', 'ActivityFeed');
  }
  if (hasEcommerce) {
    components.push('ProductCard', 'CartDrawer', 'CheckoutModal');
  }
  if (hasAuth) {
    components.push('AuthModal', 'UserProfileMenu');
  }

  // Acceptance criteria
  const acceptanceCriteria: string[] = [
    `Application must strictly adhere to the ${framework.toUpperCase()} contract.`,
    'Main landing and UI routes must render without runtime or compilation errors.',
    'Navigation components must link to all declared routes.',
    'UI must be responsive across mobile (375px), tablet (768px), and desktop viewports.',
    'Zero hardcoded API keys, private tokens, or leaked secrets permitted.',
  ];

  if (hasAuth) {
    acceptanceCriteria.push('User authentication flow (sign in/sign up) must be functional or structured with standard state.');
  }
  if (hasEcommerce) {
    acceptanceCriteria.push('Products must support cart addition and item counter updates.');
  }

  // Security invariants
  const securityRequirements: string[] = [
    'Tenant isolation: users may only read and modify their own project data.',
    'Zero leaked credentials: API keys and private tokens must never be committed.',
    'All mutations must pass candidate validation and virtual compilation gates.',
    'Database access must enforce Row-Level Security policies tied to authenticated user identity.',
  ];

  // Constraints
  const constraints: string[] = [
    `Framework: ${framework} (${frameworkVersion})`,
    'Styling: Tailwind CSS utility classes',
    'Component Architecture: Modular functional React components',
    'State Management: Local React hooks or lightweight state stores',
  ];

  // Data model
  const dataModel = [
    { entity: 'User', fields: ['id', 'email', 'name', 'created_at'] },
  ];
  if (hasEcommerce) {
    dataModel.push({ entity: 'Product', fields: ['id', 'name', 'price', 'category', 'image'] });
    dataModel.push({ entity: 'Order', fields: ['id', 'user_id', 'total_amount', 'status'] });
  }
  if (hasDashboard) {
    dataModel.push({ entity: 'MetricRecord', fields: ['id', 'metric_name', 'metric_value', 'recorded_at'] });
  }

  const generatedAt = Date.now();

  const displayFramework = framework === 'nextjs' ? 'Next.js' : framework.charAt(0).toUpperCase() + framework.slice(1);

  // Generate markdown specification
  const requirementsMarkdown = `# Project Requirements & Architectural Specification

**Generated:** ${new Date(generatedAt).toISOString()}  
**Target Framework:** ${displayFramework} (${frameworkVersion})  
**Project Overview:** ${cleanPrompt}  
**Language:** ${isBangla ? 'Bengali / English' : 'English'}  

---

## 1. Technical Stack
- **Framework:** ${displayFramework} (${frameworkVersion})
- **Database Provider:** ${dbProvider}
- **Auth Provider:** ${authProvider}
- **Styling:** Tailwind CSS

---

## 2. Core Routes & Pages
${pages.map((p, i) => `- **${p}** (\`${routes[i] || '/'}\`)`).join('\n')}

---

## 3. UI Component Hierarchy
${components.map((c) => `- \`<${c} />\``).join('\n')}

---

## 4. Security & Safety Invariants
${securityRequirements.map((s) => `- ${s}`).join('\n')}

---

## 5. Acceptance Criteria
${acceptanceCriteria.map((c, i) => `${i + 1}. [ ] ${c}`).join('\n')}

---

## 6. Technical Constraints
${constraints.map((c) => `- ${c}`).join('\n')}
`;

  const spec: ProjectSpec = {
    version: '1.0.0',
    sourcePrompt: cleanPrompt,
    requirementsMarkdown,
    pages,
    routes,
    components,
    dataModel,
    acceptanceCriteria,
    constraints,
    securityRequirements,
    framework,
    frameworkVersion,
    dbProvider,
    authProvider,
    createdAt: generatedAt,
    updatedAt: generatedAt,
  };

  return { spec, requirementsMarkdown };
}
