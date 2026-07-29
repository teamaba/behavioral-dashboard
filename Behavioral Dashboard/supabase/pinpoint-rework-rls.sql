-- ============================================================
-- PINPOINT REWORK — ROW LEVEL SECURITY
-- Run once in the Supabase SQL Editor, AFTER pinpoint-rework-schema.sql.
-- Mirrors the old staff/participant/guide 3-tier shape, retargeted onto
-- categories/pinpoints/participant_pinpoints.
-- ============================================================

ALTER TABLE categories            ENABLE ROW LEVEL SECURITY;
ALTER TABLE pinpoints             ENABLE ROW LEVEL SECURITY;
ALTER TABLE participant_pinpoints ENABLE ROW LEVEL SECURITY;

-- goals was created back in hierarchy-migration.sql with policies but never
-- actually had RLS switched on for it (the Supabase security advisor flags
-- this as "table publicly accessible") — fixed here since this file already
-- redefines goals' policies below.
ALTER TABLE goals ENABLE ROW LEVEL SECURITY;

-- ── Categories: staff/supervisor only — same as pinpoints, the library is an
-- internal tool. No client/guide code path reads categories in this app
-- (unlike the old domains table, which clients needed for their own chart
-- tree) — the old "any authenticated user reads" policy was carried over
-- from that pattern without being needed anymore, so it's dropped here.
DROP POLICY IF EXISTS "categories_read" ON categories;
DROP POLICY IF EXISTS "staff_categories_all" ON categories;
CREATE POLICY "staff_categories_all" ON categories
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('staff','supervisor'))
  );

-- ── Pinpoints: staff/supervisor only — the library is an internal tool ─────
DROP POLICY IF EXISTS "staff_pinpoints_all" ON pinpoints;
CREATE POLICY "staff_pinpoints_all" ON pinpoints
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('staff','supervisor'))
  );

-- ── Participant Pinpoints: staff full access; participant/guide read own ──
DROP POLICY IF EXISTS "staff_participant_pinpoints_all"       ON participant_pinpoints;
DROP POLICY IF EXISTS "participant_pinpoints_self_read"       ON participant_pinpoints;
DROP POLICY IF EXISTS "guide_participant_pinpoints_read"      ON participant_pinpoints;
CREATE POLICY "staff_participant_pinpoints_all" ON participant_pinpoints
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('staff','supervisor'))
  );
CREATE POLICY "participant_pinpoints_self_read" ON participant_pinpoints
  FOR SELECT USING (
    participant_id IN (SELECT id FROM participants WHERE user_id = auth.uid())
  );
CREATE POLICY "guide_participant_pinpoints_read" ON participant_pinpoints
  FOR SELECT USING (
    participant_id IN (SELECT participant_id FROM guide_participants WHERE guide_user_id = auth.uid())
  );

-- ── data_points: same 3-tier pattern, one join hop shorter than before ─────
DROP POLICY IF EXISTS "participant_points_read" ON data_points;
DROP POLICY IF EXISTS "guide_points_read"        ON data_points;
CREATE POLICY "participant_points_read" ON data_points
  FOR SELECT USING (
    instance_id IN (
      SELECT pp.id FROM participant_pinpoints pp
      JOIN participants p ON pp.participant_id = p.id
      WHERE p.user_id = auth.uid()
    )
  );
CREATE POLICY "guide_points_read" ON data_points
  FOR SELECT USING (
    instance_id IN (
      SELECT pp.id FROM participant_pinpoints pp
      WHERE pp.participant_id IN (SELECT participant_id FROM guide_participants WHERE guide_user_id = auth.uid())
    )
  );

-- ── chart_meta: same pattern ────────────────────────────────────────────────
DROP POLICY IF EXISTS "participant_meta_read" ON chart_meta;
DROP POLICY IF EXISTS "guide_meta_read"        ON chart_meta;
CREATE POLICY "participant_meta_read" ON chart_meta
  FOR SELECT USING (
    instance_id IN (
      SELECT pp.id FROM participant_pinpoints pp
      JOIN participants p ON pp.participant_id = p.id
      WHERE p.user_id = auth.uid()
    )
  );
CREATE POLICY "guide_meta_read" ON chart_meta
  FOR SELECT USING (
    instance_id IN (
      SELECT pp.id FROM participant_pinpoints pp
      WHERE pp.participant_id IN (SELECT participant_id FROM guide_participants WHERE guide_user_id = auth.uid())
    )
  );

-- ── goals: same pattern ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "staff_goals_all"        ON goals;
DROP POLICY IF EXISTS "participant_goals_read" ON goals;
DROP POLICY IF EXISTS "guide_goals_read"        ON goals;
CREATE POLICY "staff_goals_all" ON goals
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('staff','supervisor'))
  );
CREATE POLICY "participant_goals_read" ON goals
  FOR SELECT USING (
    instance_id IN (
      SELECT pp.id FROM participant_pinpoints pp
      JOIN participants p ON pp.participant_id = p.id
      WHERE p.user_id = auth.uid()
    )
  );
CREATE POLICY "guide_goals_read" ON goals
  FOR SELECT USING (
    instance_id IN (
      SELECT pp.id FROM participant_pinpoints pp
      WHERE pp.participant_id IN (SELECT participant_id FROM guide_participants WHERE guide_user_id = auth.uid())
    )
  );
