-- ============================================================
-- PROTECT SEEDED CATEGORIES
-- Run once in the Supabase SQL Editor.
--
-- The 4 "Game Speed" folders (Movement Fluency/movement, Physical Load/
-- physical, Decision Fluency/decision, Emotional Performance/emotional)
-- are the only categories with a non-null slug — user-created folders never
-- get one (see DB.categories.add in js/db.js). This blocks deleting any
-- row with a slug, at the database level, regardless of client.
-- ============================================================

CREATE OR REPLACE FUNCTION prevent_seeded_category_delete()
RETURNS trigger AS $$
BEGIN
  IF OLD.slug IS NOT NULL THEN
    RAISE EXCEPTION 'The "%" folder is one of the four built-in Game Speed folders and cannot be deleted.', OLD.name;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protect_seeded_categories ON categories;
CREATE TRIGGER trg_protect_seeded_categories
  BEFORE DELETE ON categories
  FOR EACH ROW EXECUTE FUNCTION prevent_seeded_category_delete();
