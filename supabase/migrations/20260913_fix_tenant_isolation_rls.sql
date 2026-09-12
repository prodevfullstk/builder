-- Migration: Fix Cross-Tenant Isolation & Enforce Strict Row Level Security
-- Created: 2026-09-13
-- Target Table: public.projects

-- 1. Ensure RLS is enabled on public.projects
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

-- 2. Drop all insecure or permissive legacy policies
DROP POLICY IF EXISTS "Allow anon and authenticated all access" ON public.projects;
DROP POLICY IF EXISTS "Users can only view their own projects" ON public.projects;
DROP POLICY IF EXISTS "Users can only insert their own projects" ON public.projects;
DROP POLICY IF EXISTS "Users can only update their own projects" ON public.projects;
DROP POLICY IF EXISTS "Users can only delete their own projects" ON public.projects;
DROP POLICY IF EXISTS "Users can only manage their own projects" ON public.projects;

-- 3. Policy: Authenticated users can SELECT only their own projects
CREATE POLICY "Users can only view their own projects"
ON public.projects
FOR SELECT
TO authenticated
USING (auth.uid()::text = user_id);

-- 4. Policy: Authenticated users can INSERT only projects where user_id matches their own auth.uid()
CREATE POLICY "Users can only insert their own projects"
ON public.projects
FOR INSERT
TO authenticated
WITH CHECK (auth.uid()::text = user_id);

-- 5. Policy: Authenticated users can UPDATE only their own projects and cannot transfer ownership
CREATE POLICY "Users can only update their own projects"
ON public.projects
FOR UPDATE
TO authenticated
USING (auth.uid()::text = user_id)
WITH CHECK (auth.uid()::text = user_id);

-- 6. Policy: Authenticated users can DELETE only their own projects
CREATE POLICY "Users can only delete their own projects"
ON public.projects
FOR DELETE
TO authenticated
USING (auth.uid()::text = user_id);

-- 7. Notify PostgREST to reload the schema cache immediately
NOTIFY pgrst, 'reload schema';
