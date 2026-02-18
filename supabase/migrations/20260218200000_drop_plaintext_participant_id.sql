-- Drop the plaintext participant_id column now that encryption backfill is complete.
-- Also add NOT NULL constraints on the encrypted columns.

ALTER TABLE participant_pseudonyms DROP COLUMN IF EXISTS participant_id;
ALTER TABLE participant_pseudonyms ALTER COLUMN participant_id_hash SET NOT NULL;
ALTER TABLE participant_pseudonyms ALTER COLUMN participant_id_encrypted SET NOT NULL;
