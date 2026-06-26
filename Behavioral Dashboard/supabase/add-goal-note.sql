-- Add note column to goals table
ALTER TABLE goals ADD COLUMN IF NOT EXISTS note text;
