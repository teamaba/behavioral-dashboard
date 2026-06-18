-- Run once in Supabase SQL Editor.
-- Uses direct subqueries instead of a helper function to avoid
-- SECURITY DEFINER evaluation issues in policy contexts.

-- ── Helper function (still needed for profiles policies) ──────────────────
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM profiles WHERE id = auth.uid()
$$;

-- ── profiles policies ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "supervisors_read_all_profiles"    ON public.profiles;
DROP POLICY IF EXISTS "supervisors_update_profiles"      ON public.profiles;
DROP POLICY IF EXISTS "supervisors_delete_profiles"      ON public.profiles;

CREATE POLICY "supervisors_read_all_profiles" ON public.profiles
  FOR SELECT
  USING ( public.current_user_role() = 'supervisor' );

CREATE POLICY "supervisors_update_profiles" ON public.profiles
  FOR UPDATE
  USING ( public.current_user_role() = 'supervisor' );

CREATE POLICY "supervisors_delete_profiles" ON public.profiles
  FOR DELETE
  USING ( public.current_user_role() = 'supervisor' );

-- ── allowed_emails policies ───────────────────────────────────────────────
-- Use a direct subquery here — avoids any SECURITY DEFINER chain issue.
-- This works because profiles already has a policy allowing users to
-- read their own row (required for login to function at all).

DROP POLICY IF EXISTS "supervisors_insert_allowed_emails" ON public.allowed_emails;
DROP POLICY IF EXISTS "supervisors_delete_allowed_emails" ON public.allowed_emails;

CREATE POLICY "supervisors_insert_allowed_emails" ON public.allowed_emails
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'supervisor'
    )
  );

CREATE POLICY "supervisors_delete_allowed_emails" ON public.allowed_emails
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'supervisor'
    )
  );
