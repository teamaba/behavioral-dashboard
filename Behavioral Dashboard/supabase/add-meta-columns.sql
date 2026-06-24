-- Run once in Supabase SQL Editor to add new chart_meta columns.
ALTER TABLE chart_meta
  ADD COLUMN IF NOT EXISTS organization text,
  ADD COLUMN IF NOT EXISTS charter      text,
  ADD COLUMN IF NOT EXISTS environment  text,
  ADD COLUMN IF NOT EXISTS correct      text,
  ADD COLUMN IF NOT EXISTS incorrect    text,
  ADD COLUMN IF NOT EXISTS neutral      text,
  ADD COLUMN IF NOT EXISTS acceltarget  numeric,
  ADD COLUMN IF NOT EXISTS deceltarget  numeric;
