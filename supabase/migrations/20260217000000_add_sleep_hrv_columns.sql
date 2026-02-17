-- Migration: Add detailed sleep breakdown and HRV columns to garmin_metrics
-- These are populated by the HEALTH - Sleeps and HEALTH - HRV Summary webhooks.

DO $$
DECLARE
    col_record RECORD;
    cols text[][] := ARRAY[
        -- Sleep breakdown (from HEALTH - Sleeps endpoint)
        ARRAY['deep_sleep_seconds', 'int'],
        ARRAY['light_sleep_seconds', 'int'],
        ARRAY['rem_sleep_seconds', 'int'],
        ARRAY['awake_seconds', 'int'],
        ARRAY['sleep_score_qualifier', 'text'],
        ARRAY['sleep_validation', 'text'],
        ARRAY['sleep_start_time', 'timestamptz'],

        -- HRV (from HEALTH - HRV Summary endpoint)
        ARRAY['hrv_weekly_average', 'real'],
        ARRAY['hrv_last_night', 'real'],
        ARRAY['hrv_last_night_average', 'real'],
        ARRAY['hrv_last_night_5_min_high', 'real'],
        ARRAY['hrv_status', 'text']
    ];
    col_name text;
    col_type text;
BEGIN
    FOR i IN 1..array_length(cols, 1) LOOP
        col_name := cols[i][1];
        col_type := cols[i][2];
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'garmin_metrics'
              AND column_name = col_name
        ) THEN
            EXECUTE format('ALTER TABLE garmin_metrics ADD COLUMN %I %s', col_name, col_type);
            RAISE NOTICE 'Added column: %', col_name;
        ELSE
            RAISE NOTICE 'Column already exists, skipping: %', col_name;
        END IF;
    END LOOP;
END $$;
