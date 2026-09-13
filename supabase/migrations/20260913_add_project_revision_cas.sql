-- Migration: Add Project Revision & Atomic Compare-And-Swap (CAS) Function
-- Created: 2026-09-13
-- Target Table: public.projects

-- 1. Add revision column to public.projects if not already present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'revision'
  ) THEN
    ALTER TABLE public.projects ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
  END IF;
END $$;

-- 2. Create or replace atomic Compare-And-Swap function for project revisions
CREATE OR REPLACE FUNCTION public.commit_project_revision_cas(
  p_project_id TEXT,
  p_expected_revision INTEGER,
  p_name TEXT,
  p_framework TEXT,
  p_files JSONB,
  p_messages JSONB DEFAULT '[]'::jsonb
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_rev INTEGER;
  v_new_rev INTEGER;
  v_user_id TEXT;
BEGIN
  v_user_id := auth.uid()::text;
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'conflict', false,
      'error', 'Unauthorized: Authentication required.'
    );
  END IF;

  -- Select current revision with row-level lock
  SELECT revision INTO v_current_rev
  FROM public.projects
  WHERE id = p_project_id AND user_id = v_user_id
  FOR UPDATE;

  -- If project does not exist yet for this user, insert as initial revision 1
  IF NOT FOUND THEN
    INSERT INTO public.projects (
      id,
      user_id,
      name,
      framework,
      files,
      messages,
      revision,
      updated_at
    ) VALUES (
      p_project_id,
      v_user_id,
      COALESCE(p_name, 'Untitled Project'),
      COALESCE(p_framework, 'nextjs'),
      COALESCE(p_files, '{}'::jsonb),
      COALESCE(p_messages, '[]'::jsonb),
      1,
      NOW()
    );

    RETURN jsonb_build_object(
      'success', true,
      'conflict', false,
      'revision', 1,
      'action', 'created'
    );
  END IF;

  -- Compare current revision with expected baseline
  IF v_current_rev <> p_expected_revision THEN
    RETURN jsonb_build_object(
      'success', false,
      'conflict', true,
      'current_revision', v_current_rev,
      'expected_revision', p_expected_revision,
      'error', 'Conflict: Your project changed while this generation was running. The generated changes were not committed.'
    );
  END IF;

  -- Atomic update and monotonic increment
  v_new_rev := v_current_rev + 1;

  UPDATE public.projects
  SET
    name = COALESCE(p_name, name),
    framework = COALESCE(p_framework, framework),
    files = COALESCE(p_files, files),
    messages = COALESCE(p_messages, messages),
    revision = v_new_rev,
    updated_at = NOW()
  WHERE id = p_project_id AND user_id = v_user_id AND revision = p_expected_revision;

  RETURN jsonb_build_object(
    'success', true,
    'conflict', false,
    'revision', v_new_rev,
    'action', 'updated'
  );
END;
$$;

-- 3. Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.commit_project_revision_cas TO authenticated;

-- 4. Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';
