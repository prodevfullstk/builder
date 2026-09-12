# Audit #3 — Adversarial Production Verification Specification

## 1. Audit Objectives
This document defines the rigorous, adversarial re-audit of the codebase following the Phase 1 implementation. Its objective is to strictly distinguish between **verified evidence** (demonstrated via live execution, robust integration tests, and real server-side validation) and **unverified claims** (assertions supported only by unit tests, mocks, or documentation).

## 2. Claims Being Tested & Evidence Thresholds

| Claim Area | Asserted in Audit #2 | Adversarial Verification Requirement | What Counts as Proof |
| :--- | :--- | :--- | :--- |
| **Authentication** | Real Supabase auth, no fake demo fallback | Verify actual Supabase REST authentication, token verification on protected endpoints, demo isolation. | A real integration test invoking Supabase auth, or direct REST verification with real keys. Unit test with mocks is NOT E2E proof. |
| **Project Authority** | Strict ownership, no default/first project selection | Audit all endpoints accepting `projectId`, `userId`, `owner_id`. Prove missing/wrong IDs fail with 400/403. | Static grep audit of repository + endpoint tests demonstrating rejection. |
| **MCP Authoritative Store** | Unified workspace between MCP and Builder | Trace MCP `write_file`, `edit_file`, `delete_file` through to candidate validation and authoritative store. | Must prove MCP does not maintain an isolated, divergent in-memory store. |
| **Candidate Pipeline** | Atomic validation gate before state commit | Trace AI output to candidate workspace, server validation, and commit. Test client bypass vulnerability. | Server-side or authoritative commit boundary test. Verify a malicious client cannot bypass validation. |
| **Framework Compliance** | Next.js, Vite, Astro, Node deterministic validation | Beyond static file checks: test actual builds of generated candidate fixtures in isolated sandboxes. | Real `pnpm build` of positive, negative, and cross-framework fixtures. |
| **Sandbox Truthfulness** | `visual_preview` vs `framework_runtime` separation | Audit `app/api/sandbox/route.ts` and adapters. Test that static/custom servers are never falsely labeled `framework_runtime`. | End-to-end sandbox status test proving status truthfulness across all 4 cases. |
| **Dependency Normalization**| Safe, non-mutating normalization | Verify user source `package.json` is identical before and after runtime normalization. | File diff proof and test verifying zero mutations on source project files. |
| **GitHub PAT Security** | In-memory only, no force push, conflict check | Verify no PAT persisted in `localStorage`/`sessionStorage`/logs. Verify `force: false` and conflict rejection. | Code audit + concurrency/divergence test. |
| **Requirements Source of Truth** | Requirements enforced in generation loop | Check if requirements markdown files are actively fed to prompts and checked in later edits. | Code audit of prompt assembly and verification pipeline. |
| **Visual-Fix & Auto-Fix** | Surgical editing and transactional auto-fix | Test whether visual-fix/auto-fix preserves unchanged files and rolls back upon validation/build failure. | Integration test simulating failure and verifying state rollback. |
| **Persistence Truthfulness**| Authoritative persistence vs cache | Audit project storage, cloud sync, and Zustand stores. Verify truthful failure reporting. | Code audit of error handling and sync status. |

## 3. Evidence Classification
- **Unit Test Evidence:** Confirms isolated function behavior in memory (e.g. `validateFrameworkContract` regex matching). **Does not prove production runtime compatibility.**
- **Integration Test Evidence:** Exercises interaction across multiple modules (e.g. auth validation -> project authority -> storage).
- **Real Runtime Evidence:** Execution in actual external runtime or real framework build tool (e.g. `next build` on a generated Next.js project, real HTTP request to Supabase API).

## 4. Acceptance Criteria
1. Zero unverified claims presented as verified facts.
2. All endpoints categorized in a security matrix (Real Auth vs Demo vs Ownership).
3. If MCP uses a divergent store or client validation can be bypassed, classify as P0 finding.
4. Actual framework build verification executed on isolated generated projects.
5. All findings scored by severity (P0, P1, P2, P3).