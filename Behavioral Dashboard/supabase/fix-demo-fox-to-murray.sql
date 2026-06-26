-- Rename De'Aaron Fox → Keegan Murray and update his behaviors
UPDATE participants
SET name = 'Keegan Murray'
WHERE name = 'De''Aaron Fox';

UPDATE behaviors
SET name = 'Corner Three'
WHERE name = 'Transition Speed'
  AND participant_id = (SELECT id FROM participants WHERE name = 'Keegan Murray' LIMIT 1);

UPDATE behaviors
SET name = 'Off-Ball Movement'
WHERE name = 'Decision Making'
  AND participant_id = (SELECT id FROM participants WHERE name = 'Keegan Murray' LIMIT 1);
