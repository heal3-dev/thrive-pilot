-- Migration: Ensure participants table has Garmin columns
-- It seems these were missing on production, causing API failures.

DO $$
BEGIN
    -- Add garmin_user_id if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'participants' AND column_name = 'garmin_user_id'
    ) THEN
        ALTER TABLE participants ADD COLUMN garmin_user_id text;
        RAISE NOTICE 'Added column: garmin_user_id';
    END IF;

    -- Add garmin_connected_at if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'participants' AND column_name = 'garmin_connected_at'
    ) THEN
        ALTER TABLE participants ADD COLUMN garmin_connected_at timestamptz;
        RAISE NOTICE 'Added column: garmin_connected_at';
    END IF;

    -- Add unique constraint on garmin_user_id if appropriate?
    -- Maybe not strictly required to fix the error, but good practice.
    -- We'll skip constraint for now to avoid conflicts if data is messy.

END $$;
