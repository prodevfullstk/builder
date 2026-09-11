/**
 * Database & Auth Provider Templates
 * Used by the AI agent to generate proper DB schemas, migrations, and config files
 */

export type DBProvider = "supabase" | "mysql" | "postgres" | "sqlite" | "prisma" | "drizzle" | "none";
export type AuthProvider = "supabase" | "nextauth" | "clerk" | "none";

// ─── Supabase ──────────────────────────────────────────────────────────────

export function getSupabaseTemplate(): string {
  return `
### SUPABASE GENERATION RULES:
MANDATORY: You MUST generate database SQL files in the \`supabase/\` directory. Do NOT omit SQL files or put raw SQL in TypeScript files!
Generate these files:

1. supabase/schema.sql (or supabase/migrations/001_initial_schema.sql) — Full PostgreSQL DDL:
   - CREATE TABLE statements with appropriate column types, NOT NULL, PRIMARY KEY, and FOREIGN KEY constraints.
   - ENABLE ROW LEVEL SECURITY on all tables.
   - CREATE POLICY for SELECT, INSERT, UPDATE, DELETE (using auth.uid()).
   - Triggers for updated_at timestamps.
2. supabase/seed.sql — INSERT statements with realistic sample/demo data matching the schema.
3. src/lib/supabase.ts (for Vite) or lib/supabase.ts (for Next.js) — createClient() setup with fallback mock data or graceful fallback if environment variables are missing, so the app runs smoothly in preview without throwing errors!
4. .env.example — VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY)

CRITICAL: NEVER hardcode API keys, URLs, or credentials in any source file.
CRITICAL: NEVER omit the supabase/schema.sql file when Supabase is requested!`;
}

// ─── MySQL ─────────────────────────────────────────────────────────────────

export function getMySQLTemplate(): string {
  return `
### MYSQL GENERATION RULES:
Generate these additional files:

1. database/schema.sql — CREATE TABLE statements with proper indexes and constraints
2. database/seed.sql — INSERT sample data
3. lib/db.ts — mysql2/promise connection pool using DATABASE_URL env var
4. .env.example — DATABASE_URL=mysql://user:password@localhost:3306/dbname

CRITICAL: NEVER hardcode credentials. Always use parameterized queries to prevent SQL injection.`;
}

// ─── PostgreSQL ────────────────────────────────────────────────────────────

export function getPostgresTemplate(): string {
  return `
### POSTGRESQL GENERATION RULES:
Generate these additional files:

1. database/schema.sql — CREATE TABLE with proper types, indexes, and constraints
2. database/seed.sql — INSERT sample data
3. lib/db.ts — pg Pool setup using DATABASE_URL env var
4. .env.example — DATABASE_URL=postgresql://user:password@localhost:5432/dbname

CRITICAL: Use parameterized queries ($1, $2...). Never interpolate user input into SQL strings.`;
}

// ─── Prisma ────────────────────────────────────────────────────────────────

export function getPrismaTemplate(): string {
  return `
### PRISMA ORM GENERATION RULES:
Generate these additional files:

1. prisma/schema.prisma — complete Prisma data model with all relations and types
2. lib/prisma.ts — PrismaClient singleton using this exact pattern:
   import { PrismaClient } from '@prisma/client';
   const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };
   export const prisma = globalForPrisma.prisma || new PrismaClient();
   if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
3. .env.example — DATABASE_URL=postgresql://...

Generate realistic, complete schema. Include createdAt/updatedAt on every model.`;
}

// ─── Drizzle ───────────────────────────────────────────────────────────────

export function getDrizzleTemplate(): string {
  return `
### DRIZZLE ORM GENERATION RULES:
Generate these additional files:

1. src/db/schema.ts — Drizzle table definitions (pgTable or mysqlTable)
2. src/db/index.ts — database connection export
3. drizzle.config.ts — Drizzle Kit migration config
4. .env.example — DATABASE_URL

Use the correct adapter: neon() for Postgres, planetscale() for MySQL.`;
}

// ─── Auth ──────────────────────────────────────────────────────────────────

export function getAuthTemplate(provider: AuthProvider): string {
  if (provider === "supabase") {
    return `
### SUPABASE AUTH GENERATION RULES:
- Use @supabase/auth-helpers-nextjs for Next.js auth
- Generate app/login/page.tsx and app/register/page.tsx
- Generate middleware.ts to protect routes using createMiddlewareClient
- All protected API routes must verify auth.uid()`;
  }

  if (provider === "nextauth") {
    return `
### NEXT-AUTH GENERATION RULES:
- Generate app/api/auth/[...nextauth]/route.ts with Google + Credentials providers
- Wrap app in <SessionProvider> in app/layout.tsx
- Generate useSession() usage in protected components
- Add NEXTAUTH_SECRET and NEXTAUTH_URL to .env.example`;
  }

  if (provider === "clerk") {
    return `
### CLERK AUTH GENERATION RULES:
- Wrap app in <ClerkProvider> in app/layout.tsx
- Use <SignIn />, <SignUp />, <UserButton /> from @clerk/nextjs
- Generate middleware.ts with clerkMiddleware()
- Add NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY to .env.example`;
  }

  return "";
}

// ─── Combined DB + Auth guide ──────────────────────────────────────────────

export function getFullStackDBGuide(db: DBProvider, auth: AuthProvider): string {
  const parts: string[] = [];

  if (db === "supabase") parts.push(getSupabaseTemplate());
  else if (db === "mysql") parts.push(getMySQLTemplate());
  else if (db === "postgres") parts.push(getPostgresTemplate());
  else if (db === "prisma") parts.push(getPrismaTemplate());
  else if (db === "drizzle") parts.push(getDrizzleTemplate());

  const authGuide = getAuthTemplate(auth);
  if (authGuide) parts.push(authGuide);

  return parts.join("\n\n");
}
