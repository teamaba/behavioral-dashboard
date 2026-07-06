-- Run once in the Supabase SQL Editor.
-- Adds a "guide" role: read-only access to a hand-picked set of participants
-- (e.g. an outside coach/trainer), distinct from "client" (which is scoped to
-- exactly one participant via participants.user_id).

-- ── Widen role check constraints ────────────────────────────────────────────
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check,
  ADD CONSTRAINT profiles_role_check CHECK (role IN ('staff','client','supervisor','guide'));

ALTER TABLE allowed_emails DROP CONSTRAINT IF EXISTS allowed_emails_role_check,
  ADD CONSTRAINT allowed_emails_role_check CHECK (role IN ('staff','client','supervisor','guide'));

-- ── Many-to-many: which participants a guide can see ────────────────────────
CREATE TABLE IF NOT EXISTS guide_participants (
  guide_user_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  created_at     timestamptz DEFAULT now(),
  PRIMARY KEY (guide_user_id, participant_id)
);
ALTER TABLE guide_participants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "supervisor_manage_guide_participants" ON guide_participants;
CREATE POLICY "supervisor_manage_guide_participants" ON guide_participants
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'supervisor')
  );

DROP POLICY IF EXISTS "guide_read_own_assignments" ON guide_participants;
CREATE POLICY "guide_read_own_assignments" ON guide_participants
  FOR SELECT USING (guide_user_id = auth.uid());

-- ── Guide read policies — same join-chain shape as the existing participant_*_read policies ──

DROP POLICY IF EXISTS "guide_teams_read" ON teams;
CREATE POLICY "guide_teams_read" ON teams
  FOR SELECT USING (
    id IN (
      SELECT p.team_id FROM participants p
      JOIN guide_participants gp ON gp.participant_id = p.id
      WHERE gp.guide_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "guide_participants_read" ON participants;
CREATE POLICY "guide_participants_read" ON participants
  FOR SELECT USING (
    id IN (SELECT participant_id FROM guide_participants WHERE guide_user_id = auth.uid())
  );

DROP POLICY IF EXISTS "guide_behaviors_read" ON behaviors;
CREATE POLICY "guide_behaviors_read" ON behaviors
  FOR SELECT USING (
    participant_id IN (SELECT participant_id FROM guide_participants WHERE guide_user_id = auth.uid())
  );

DROP POLICY IF EXISTS "guide_points_read" ON data_points;
CREATE POLICY "guide_points_read" ON data_points
  FOR SELECT USING (
    behavior_id IN (
      SELECT b.id FROM behaviors b
      WHERE b.participant_id IN (SELECT participant_id FROM guide_participants WHERE guide_user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "guide_meta_read" ON chart_meta;
CREATE POLICY "guide_meta_read" ON chart_meta
  FOR SELECT USING (
    behavior_id IN (
      SELECT b.id FROM behaviors b
      WHERE b.participant_id IN (SELECT participant_id FROM guide_participants WHERE guide_user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "guide_goals_read" ON goals;
CREATE POLICY "guide_goals_read" ON goals
  FOR SELECT USING (
    behavior_id IN (
      SELECT b.id FROM behaviors b
      WHERE b.participant_id IN (SELECT participant_id FROM guide_participants WHERE guide_user_id = auth.uid())
    )
  );

-- domains: already open to any authenticated user — no change needed.
-- notification_emails: staff/supervisor only — guides never touch it, no change needed.
