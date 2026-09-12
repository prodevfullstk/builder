import { describe, it } from 'node:test';
import assert from 'node:assert';
import { synthesizeProjectRequirements } from '../lib/ai/requirements-generator';

describe('Requirements Specification Generator & Persistence (P1-D)', () => {
  it('generates a complete structured ProjectSpec for Next.js SaaS app', () => {
    const prompt = 'Build a SaaS billing dashboard with Stripe, Supabase PostgreSQL, and dark theme';
    const { spec, requirementsMarkdown } = synthesizeProjectRequirements(
      prompt,
      'nextjs',
      'supabase',
      'supabase'
    );

    assert.ok(spec);
    assert.strictEqual(spec.framework, 'nextjs');
    assert.strictEqual(spec.frameworkVersion, '^15.0.0');
    assert.strictEqual(spec.dbProvider, 'supabase');
    assert.strictEqual(spec.authProvider, 'supabase');
    assert.ok(spec.routes.length >= 1);
    assert.ok(spec.components.length >= 1);
    assert.ok(Array.isArray(spec.dataModel));
    assert.ok(spec.securityRequirements.length >= 1);

    // Verify Markdown format
    assert.ok(requirementsMarkdown.includes('# Project Requirements & Architectural Specification'));
    assert.ok(requirementsMarkdown.includes('## 1. Technical Stack'));
    assert.ok(requirementsMarkdown.includes('## 2. Core Routes & Pages'));
    assert.ok(requirementsMarkdown.includes('## 3. UI Component Hierarchy'));
    assert.ok(requirementsMarkdown.includes('## 4. Security & Safety Invariants'));
  });

  it('adapts spec and requirements to Vite React portfolio project', () => {
    const prompt = 'Create a developer portfolio with 3D canvas, project showcase, and contact form';
    const { spec, requirementsMarkdown } = synthesizeProjectRequirements(
      prompt,
      'vite',
      'none',
      'none'
    );

    assert.strictEqual(spec.framework, 'vite');
    assert.strictEqual(spec.frameworkVersion, '^5.0.0');
    assert.ok(requirementsMarkdown.includes('Vite'));
    assert.ok(requirementsMarkdown.includes('portfolio'));
  });
});
