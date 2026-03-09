-- Migration: Drop stale triggers/indexes on garmin_tokens that reference
-- the old participant_id column (removed in pseudonymization migration).
--
-- Fixes: "record 'new' has no field 'participant_id'" error on INSERT.

BEGIN;

-- Drop stale indexes that referenced participant_id (may already be gone
-- if Postgres auto-dropped them with the column, but be explicit).
DROP INDEX IF EXISTS idx_garmin_tokens_active;
DROP INDEX IF EXISTS idx_garmin_tokens_participant_latest;

-- Drop and recreate any triggers whose backing function might reference
-- participant_id (the update_garmin_tokens_updated_at trigger is safe,
-- but re-check by recreating it cleanly).
DROP TRIGGER IF EXISTS trg_garmin_tokens_updated_at ON garmin_tokens;

CREATE OR REPLACE FUNCTION update_garmin_tokens_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_garmin_tokens_updated_at
    BEFORE UPDATE ON garmin_tokens
    FOR EACH ROW
    EXECUTE FUNCTION update_garmin_tokens_updated_at();

-- List all triggers on garmin_tokens to verify nothing stale remains.
-- (This block does nothing functionally, just logs.)
DO $$
DECLARE
    trg RECORD;
BEGIN
    FOR trg IN
        SELECT tgname, tgtype FROM pg_trigger
        WHERE tgrelid = 'garmin_tokens'::regclass
          AND NOT tgisinternal
    LOOP
        RAISE NOTICE 'garmin_tokens trigger: % (type=%)', trg.tgname, trg.tgtype;
    END LOOP;
END $$;

COMMIT;
