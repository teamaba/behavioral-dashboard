-- ============================================================
-- PROTECT OWNER ACCOUNT
-- Run once in the Supabase SQL Editor.
--
-- Blocks deletion of the owner's profile row at the database level,
-- regardless of caller — covers the remove_user RPC (invite.js's "Remove"
-- button, usable by any supervisor, not just self) and any direct REST
-- DELETE against /profiles. Same trigger-based approach as
-- protect-seeded-categories.sql.
-- ============================================================

CREATE OR REPLACE FUNCTION prevent_owner_profile_delete()
RETURNS trigger AS $$
BEGIN
  IF OLD.email = 'bdean@teamaballc.com' THEN
    RAISE EXCEPTION 'This account cannot be removed.';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protect_owner_account ON profiles;
CREATE TRIGGER trg_protect_owner_account
  BEFORE DELETE ON profiles
  FOR EACH ROW EXECUTE FUNCTION prevent_owner_profile_delete();
