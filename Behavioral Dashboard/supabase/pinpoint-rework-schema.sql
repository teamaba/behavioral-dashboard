-- ============================================================
-- PINPOINT REWORK — SCHEMA
-- Run once in the Supabase SQL Editor, before pinpoint-rework-rls.sql.
--
-- Replaces the old Team → Participant → Behavior → 4 fixed Domains model
-- with Team → Participant → Pinpoint Chart Instance, where each instance is
-- copied (not linked) from a reusable Pinpoint Library template living
-- inside an open-ended, nestable Category tree.
--
-- Clean cutover — the "behaviors" and "domains" tables (and everything keyed
-- on behavior_id+domain_id) are dropped, not migrated. Production data at
-- the time of writing is demo/test data only.
-- ============================================================

-- 1. Drop the old hierarchy tables. CASCADE removes their FK constraints on
--    data_points/chart_meta/goals, but NOT the behavior_id/domain_id/
--    domain_slug columns themselves — those are dropped explicitly below.
DROP TABLE IF EXISTS behaviors CASCADE;
DROP TABLE IF EXISTS domains   CASCADE;

-- 2. Categories — open-ended, nestable. Replaces the old fixed 4 "domains".
CREATE TABLE IF NOT EXISTS categories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  slug       text UNIQUE,
  parent_id  uuid REFERENCES categories(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

-- Seed the 4 former domain names as empty, writable, top-level categories
-- (the "Game Speed" model) — starting folders, not a fixed/locked set.
INSERT INTO categories (name, slug) VALUES
  ('Movement Fluency',      'movement'),
  ('Physical Load',         'physical'),
  ('Decision Fluency',      'decision'),
  ('Emotional Performance', 'emotional')
ON CONFLICT (slug) DO NOTHING;

-- 3. Pinpoints — the reusable library templates that live inside categories.
CREATE TABLE IF NOT EXISTS pinpoints (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id            uuid REFERENCES categories(id) ON DELETE SET NULL,
  name                   text NOT NULL,
  description            text,
  measurement_type       text NOT NULL CHECK (measurement_type IN ('frequency','duration','latency','count_per_day')),
  has_neutral_field      boolean NOT NULL DEFAULT false,
  include_record_ceiling boolean NOT NULL DEFAULT false,
  default_counting_time  integer,
  goal_direction         text CHECK (goal_direction IN ('acceleration','deceleration')),
  target_min             numeric,
  target_max             numeric,
  correct_label          text,
  incorrect_label        text,
  neutral_label          text,
  default_view           text NOT NULL DEFAULT 'daily'
                            CHECK (default_view IN ('daily','weekly','monthly','yearly','timings','count_per_day')),
  default_point_display  text NOT NULL DEFAULT 'geometric_mean'
                            CHECK (default_point_display IN
                              ('geometric_mean','first','last','stacked','median','summative','best','worst')),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 4. Participant Pinpoints — the per-athlete chart instance. Replaces
--    "behaviors". Copies every field from a library pinpoint at creation
--    time (pinpoint_id is kept only for provenance — editing the library
--    template afterward does NOT change existing instances).
CREATE TABLE IF NOT EXISTS participant_pinpoints (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id         uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  pinpoint_id            uuid REFERENCES pinpoints(id) ON DELETE SET NULL,
  name                   text NOT NULL,
  description            text,
  measurement_type       text NOT NULL CHECK (measurement_type IN ('frequency','duration','latency','count_per_day')),
  has_neutral_field      boolean NOT NULL DEFAULT false,
  include_record_ceiling boolean NOT NULL DEFAULT false,
  default_counting_time  integer,
  goal_direction         text CHECK (goal_direction IN ('acceleration','deceleration')),
  target_min             numeric,
  target_max             numeric,
  correct_label          text,
  incorrect_label        text,
  neutral_label          text,
  view                   text NOT NULL DEFAULT 'daily'
                            CHECK (view IN ('daily','weekly','monthly','yearly','timings','count_per_day')),
  point_display          text NOT NULL DEFAULT 'geometric_mean'
                            CHECK (point_display IN
                              ('geometric_mean','first','last','stacked','median','summative','best','worst')),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

-- 5. Re-key data_points / chart_meta / goals onto participant_pinpoints.
ALTER TABLE data_points
  DROP COLUMN IF EXISTS behavior_id,
  DROP COLUMN IF EXISTS domain_id,
  DROP COLUMN IF EXISTS domain_slug,
  ADD COLUMN IF NOT EXISTS instance_id uuid REFERENCES participant_pinpoints(id) ON DELETE CASCADE;

ALTER TABLE chart_meta
  DROP COLUMN IF EXISTS behavior_id,
  DROP COLUMN IF EXISTS domain_id,
  DROP COLUMN IF EXISTS domain_slug,
  ADD COLUMN IF NOT EXISTS instance_id uuid UNIQUE REFERENCES participant_pinpoints(id) ON DELETE CASCADE;

ALTER TABLE goals
  DROP COLUMN IF EXISTS behavior_id,
  DROP COLUMN IF EXISTS domain_id,
  DROP COLUMN IF EXISTS domain_slug,
  ADD COLUMN IF NOT EXISTS instance_id uuid REFERENCES participant_pinpoints(id) ON DELETE CASCADE;

-- 6. Optional participant demographics.
ALTER TABLE participants
  ADD COLUMN IF NOT EXISTS age    integer,
  ADD COLUMN IF NOT EXISTS gender text;

-- 7. notification_emails referenced behaviors nowhere (already participant_id
--    scoped per migrate-notifications-to-participant.sql) — no change needed.
