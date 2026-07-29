-- ============================================================
-- ADD SHORT FOOTER LABELS
-- Run once in the Supabase SQL Editor.
--
-- The chart's printed footer (ORGANIZATION/SUPERVISOR/.../CORRECT/
-- INCORRECT/NEUTRAL) is a narrow fixed-width column on the canvas — too
-- tight for the fuller "Correct/Incorrect responses label" used by the
-- Legend and Program Review (sourced from the pinpoint's own labels).
-- These are separate, short-only fields set directly on the chart,
-- independent of the pinpoint — never prefilled from it.
-- ============================================================

ALTER TABLE chart_meta
  ADD COLUMN IF NOT EXISTS footer_correct   text,
  ADD COLUMN IF NOT EXISTS footer_incorrect text;
