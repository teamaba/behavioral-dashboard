-- Notification email list: supervisors manage, staff can read (for sending)
CREATE TABLE IF NOT EXISTS notification_emails (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email      text NOT NULL,
  label      text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE notification_emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can read notification emails"
  ON notification_emails FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('staff','supervisor')
  ));

CREATE POLICY "Staff can insert notification emails"
  ON notification_emails FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('staff','supervisor')
  ));

CREATE POLICY "Staff can delete notification emails"
  ON notification_emails FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('staff','supervisor')
  ));

-- Add email column to participants if not already present (needed for auto-linking)
ALTER TABLE participants ADD COLUMN IF NOT EXISTS email text;
