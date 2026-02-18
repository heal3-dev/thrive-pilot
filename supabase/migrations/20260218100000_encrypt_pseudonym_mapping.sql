-- Migration: Add encrypted columns to participant_pseudonyms.
--
-- The actual encryption + backfill is done by scripts/encrypt-pseudonym-mapping.ts
-- because the encryption key lives in Vercel env vars (not in the database).
-- After the script runs, participant_id is dropped.

-- Step 1: Add new columns (nullable until backfill completes)
ALTER TABLE participant_pseudonyms
    ADD COLUMN IF NOT EXISTS participant_id_hash text,
    ADD COLUMN IF NOT EXISTS participant_id_encrypted text;

-- Step 2: Add unique index on hash column for fast lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_pseudonyms_participant_hash
    ON participant_pseudonyms(participant_id_hash);
