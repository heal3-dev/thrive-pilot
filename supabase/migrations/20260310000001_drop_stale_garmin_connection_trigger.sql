-- Migration: Drop stale log_garmin_connection_trigger
--
-- This trigger was created directly in the database and references
-- NEW.participant_id which no longer exists on garmin_tokens (dropped
-- during pseudonymization).  It causes error 42703 on every INSERT.

BEGIN;

DROP TRIGGER IF EXISTS log_garmin_connection_trigger ON garmin_tokens;

-- Also drop the duplicate set_garmin_tokens_updated_at trigger if it
-- exists alongside trg_garmin_tokens_updated_at (only one is needed).
DROP TRIGGER IF EXISTS set_garmin_tokens_updated_at ON garmin_tokens;

COMMIT;
