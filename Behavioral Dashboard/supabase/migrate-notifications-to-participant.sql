-- Scope notification emails to individual participants
ALTER TABLE notification_emails
  ADD COLUMN IF NOT EXISTS participant_id uuid REFERENCES participants(id) ON DELETE CASCADE;

-- Remove any existing global (unscoped) entries since we're going per-participant
DELETE FROM notification_emails WHERE participant_id IS NULL;
