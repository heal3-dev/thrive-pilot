-- Migration: Add Garmin device model/type to participants (PII zone)
--
-- Purpose:
-- - Store a best-effort "device model/type" string for the participant's current Garmin device.
-- - This is populated opportunistically from webhook/backfill raw payloads when a device field is present.
-- - Displayed in the admin dashboard Garmin column.
--
-- Notes:
-- - Garmin Health API payloads may not always include device identifiers; this column is nullable.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'participants'
      AND column_name = 'garmin_device_model'
  ) THEN
    ALTER TABLE participants
      ADD COLUMN garmin_device_model text;
  END IF;
END $$;

