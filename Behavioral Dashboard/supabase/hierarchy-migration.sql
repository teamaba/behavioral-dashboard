-- ============================================================
-- HIERARCHY MIGRATION — Team → Participant → Behavior → Domains
-- Run once in the Supabase SQL Editor.
-- Safe to re-run (uses IF NOT EXISTS and ON CONFLICT DO NOTHING).
-- ============================================================

-- 1. Teams
CREATE TABLE IF NOT EXISTS teams (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE,
  created_at timestamptz DEFAULT now()
);

-- 2. Participants (athletes, learners — intentionally generic)
--    email: staff fills this in when creating a participant so the
--    auto-link trigger can connect their login account on sign-up.
CREATE TABLE IF NOT EXISTS participants (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id    uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name       text NOT NULL,
  email      text,
  user_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

-- 3. Behaviors (freely created per participant by staff — no fixed list)
CREATE TABLE IF NOT EXISTS behaviors (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  name           text NOT NULL,
  created_by     uuid REFERENCES auth.users(id),
  created_at     timestamptz DEFAULT now()
);

-- 4. Domains (fixed 4 rows — never add/edit/delete through the UI)
CREATE TABLE IF NOT EXISTS domains (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE
);

INSERT INTO domains (name, slug) VALUES
  ('Movement Fluency',      'movement'),
  ('Physical Load',         'physical'),
  ('Decision Fluency',      'decision'),
  ('Emotional Performance', 'emotional')
ON CONFLICT (slug) DO NOTHING;

-- 5. Create goals table (if not yet created) and add hierarchy columns
CREATE TABLE IF NOT EXISTS goals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_slug  text,
  behavior_id  uuid REFERENCES behaviors(id) ON DELETE CASCADE,
  domain_id    uuid REFERENCES domains(id),
  type         text NOT NULL,
  target       numeric NOT NULL,
  achieved     boolean NOT NULL DEFAULT false,
  notified_at  timestamptz,
  created_by   uuid REFERENCES auth.users(id),
  created_at   timestamptz DEFAULT now()
);

-- Add hierarchy columns to existing tables
--    (domain_slug stays; old rows keep their value, new rows use the FKs)
ALTER TABLE data_points
  ADD COLUMN IF NOT EXISTS behavior_id uuid REFERENCES behaviors(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS domain_id   uuid REFERENCES domains(id);

ALTER TABLE chart_meta
  ADD COLUMN IF NOT EXISTS behavior_id uuid REFERENCES behaviors(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS domain_id   uuid REFERENCES domains(id);

ALTER TABLE goals
  ADD COLUMN IF NOT EXISTS behavior_id uuid REFERENCES behaviors(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS domain_id   uuid REFERENCES domains(id);

-- 6. Update handle_new_user trigger to auto-link participant accounts
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger AS $$
DECLARE
  allowed record;
BEGIN
  SELECT * INTO allowed FROM allowed_emails WHERE email = new.email;
  IF allowed IS NULL THEN
    RAISE EXCEPTION 'Email % is not authorized to create an account', new.email;
  END IF;
  INSERT INTO profiles (id, email, role, client_name)
  VALUES (new.id, new.email, allowed.role, allowed.client_name);
  -- Auto-link participant record if staff pre-created one with this email
  UPDATE participants SET user_id = new.id WHERE email = new.email AND user_id IS NULL;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- RLS
-- ============================================================

ALTER TABLE teams        ENABLE ROW LEVEL SECURITY;
ALTER TABLE participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE behaviors    ENABLE ROW LEVEL SECURITY;
ALTER TABLE domains      ENABLE ROW LEVEL SECURITY;

-- Domains: any authenticated user can read (they are static reference data)
DROP POLICY IF EXISTS "domains_read" ON domains;
CREATE POLICY "domains_read" ON domains
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Teams: staff/supervisor full access; participants see their own team only
DROP POLICY IF EXISTS "staff_teams_all"        ON teams;
DROP POLICY IF EXISTS "participant_teams_read"  ON teams;
CREATE POLICY "staff_teams_all" ON teams
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('staff','supervisor'))
  );
CREATE POLICY "participant_teams_read" ON teams
  FOR SELECT USING (
    id IN (SELECT team_id FROM participants WHERE user_id = auth.uid())
  );

-- Participants: staff full access; participant reads only their own row
DROP POLICY IF EXISTS "staff_participants_all"  ON participants;
DROP POLICY IF EXISTS "participant_self_read"   ON participants;
CREATE POLICY "staff_participants_all" ON participants
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('staff','supervisor'))
  );
CREATE POLICY "participant_self_read" ON participants
  FOR SELECT USING (user_id = auth.uid());

-- Behaviors: staff full access; participant reads only their own
DROP POLICY IF EXISTS "staff_behaviors_all"        ON behaviors;
DROP POLICY IF EXISTS "participant_behaviors_read"  ON behaviors;
CREATE POLICY "staff_behaviors_all" ON behaviors
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('staff','supervisor'))
  );
CREATE POLICY "participant_behaviors_read" ON behaviors
  FOR SELECT USING (
    participant_id IN (SELECT id FROM participants WHERE user_id = auth.uid())
  );

-- data_points: replace open client policy with behavior-scoped one
DROP POLICY IF EXISTS "client read points"        ON data_points;
DROP POLICY IF EXISTS "participant_points_read"   ON data_points;
CREATE POLICY "participant_points_read" ON data_points
  FOR SELECT USING (
    behavior_id IN (
      SELECT b.id FROM behaviors b
      JOIN participants p ON b.participant_id = p.id
      WHERE p.user_id = auth.uid()
    )
  );

-- chart_meta: same pattern
DROP POLICY IF EXISTS "client read meta"       ON chart_meta;
DROP POLICY IF EXISTS "participant_meta_read"  ON chart_meta;
CREATE POLICY "participant_meta_read" ON chart_meta
  FOR SELECT USING (
    behavior_id IN (
      SELECT b.id FROM behaviors b
      JOIN participants p ON b.participant_id = p.id
      WHERE p.user_id = auth.uid()
    )
  );

-- goals: replace old policy
DROP POLICY IF EXISTS "staff can manage goals"  ON goals;
DROP POLICY IF EXISTS "staff_goals_all"         ON goals;
DROP POLICY IF EXISTS "participant_goals_read"  ON goals;
CREATE POLICY "staff_goals_all" ON goals
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('staff','supervisor'))
  );
CREATE POLICY "participant_goals_read" ON goals
  FOR SELECT USING (
    behavior_id IN (
      SELECT b.id FROM behaviors b
      JOIN participants p ON b.participant_id = p.id
      WHERE p.user_id = auth.uid()
    )
  );
