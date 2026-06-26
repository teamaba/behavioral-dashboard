-- Run this in the Supabase SQL Editor once to add the floor column.
-- floor = observation session length in seconds (e.g. 30 for "0:30:00")
ALTER TABLE data_points ADD COLUMN IF NOT EXISTS floor integer;
