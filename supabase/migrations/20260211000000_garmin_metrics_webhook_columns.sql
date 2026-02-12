-- Migration: Ensure garmin_metrics table has all columns needed for webhook ingestion
-- Garmin sends daily summaries via webhook with these fields.
-- We map them to typed columns for querying and store the full payload in raw_data.

-- If the table doesn't exist yet (e.g. fresh dev setup), create it
CREATE TABLE IF NOT EXISTS garmin_metrics (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    metric_date date NOT NULL,

    -- Activity
    steps int,
    distance_meters real,
    active_time_seconds int,
    floors_climbed int,
    intensity_minutes_moderate int,
    intensity_minutes_vigorous int,

    -- Calories
    active_calories int,
    bmr_calories int,
    total_calories int,

    -- Heart
    resting_heart_rate int,
    max_heart_rate int,
    min_heart_rate int,
    average_heart_rate int,

    -- Stress
    average_stress_level int,
    max_stress_level int,
    stress_duration_seconds int,
    rest_stress_duration_seconds int,
    low_stress_duration_seconds int,
    medium_stress_duration_seconds int,
    high_stress_duration_seconds int,

    -- Sleep (top-level daily summary fields)
    sleep_duration_seconds int,
    sleep_score real,

    -- Body Battery
    body_battery_highest int,
    body_battery_lowest int,
    body_battery_most_recent int,

    -- SpO2
    spo2_average real,
    spo2_lowest real,

    -- Respiration
    avg_waking_respiration real,
    highest_respiration real,
    lowest_respiration real,

    -- Raw API response (for debugging and future field extraction)
    raw_data jsonb,

    -- Timestamps
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),

    -- Prevent duplicate rows for same participant + date
    CONSTRAINT garmin_metrics_participant_date_uq UNIQUE (participant_id, metric_date)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_garmin_metrics_participant ON garmin_metrics(participant_id);
CREATE INDEX IF NOT EXISTS idx_garmin_metrics_date ON garmin_metrics(metric_date DESC);

-- Migration: Add missing columns to existing garmin_metrics table
-- Safe to run multiple times (idempotent)

DO $$
DECLARE
    col_record RECORD;
    cols text[][] := ARRAY[
        -- Activity
        ARRAY['steps', 'int'],
        ARRAY['steps_goal', 'int'],
        ARRAY['distance_meters', 'real'],
        ARRAY['active_time_seconds', 'int'],
        ARRAY['floors_climbed', 'int'],
        ARRAY['intensity_minutes_moderate', 'int'],
        ARRAY['intensity_minutes_vigorous', 'int'],
        ARRAY['duration_seconds', 'int'],

        -- Calories
        ARRAY['active_calories', 'int'],
        ARRAY['bmr_calories', 'int'],
        ARRAY['total_calories', 'int'],

        -- Heart Rate
        ARRAY['resting_heart_rate', 'int'],
        ARRAY['max_heart_rate', 'int'],
        ARRAY['min_heart_rate', 'int'],
        ARRAY['average_heart_rate', 'int'],

        -- HRV (already exists in your table - will be skipped)
        ARRAY['hrv_value', 'real'],

        -- Stress
        ARRAY['average_stress_level', 'int'],
        ARRAY['max_stress_level', 'int'],
        ARRAY['stress_qualifier', 'text'],
        ARRAY['stress_duration_seconds', 'int'],
        ARRAY['rest_stress_duration_seconds', 'int'],
        ARRAY['activity_stress_duration_seconds', 'int'],
        ARRAY['low_stress_duration_seconds', 'int'],
        ARRAY['medium_stress_duration_seconds', 'int'],
        ARRAY['high_stress_duration_seconds', 'int'],

        -- Sleep
        ARRAY['sleep_duration_seconds', 'int'],
        ARRAY['sleep_score', 'real'],

        -- Body Battery
        ARRAY['body_battery_highest', 'int'],
        ARRAY['body_battery_lowest', 'int'],
        ARRAY['body_battery_most_recent', 'int'],
        ARRAY['body_battery_charged', 'int'],
        ARRAY['body_battery_drained', 'int'],

        -- SpO2
        ARRAY['spo2_average', 'real'],
        ARRAY['spo2_lowest', 'real'],

        -- Respiration
        ARRAY['avg_waking_respiration', 'real'],
        ARRAY['highest_respiration', 'real'],
        ARRAY['lowest_respiration', 'real'],

        -- Raw payload
        ARRAY['raw_data', 'jsonb'],

        -- Timestamps
        ARRAY['updated_at', 'timestamptz DEFAULT now()']
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


-- Add UNIQUE constraint if not exists (one row per participant per day)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'garmin_metrics_participant_date_uq'
    ) THEN
        ALTER TABLE garmin_metrics
        ADD CONSTRAINT garmin_metrics_participant_date_uq
        UNIQUE (participant_id, metric_date);
    END IF;
END $$;


-- Indexes (IF NOT EXISTS is built-in)
CREATE INDEX IF NOT EXISTS idx_garmin_metrics_participant
    ON garmin_metrics(participant_id);
CREATE INDEX IF NOT EXISTS idx_garmin_metrics_date
    ON garmin_metrics(metric_date DESC);


-- Set defaults on timestamp columns
ALTER TABLE garmin_metrics
ALTER COLUMN created_at SET DEFAULT now();

ALTER TABLE garmin_metrics
ALTER COLUMN updated_at SET DEFAULT now();


-- RLS
ALTER TABLE garmin_metrics ENABLE ROW LEVEL SECURITY;


-- Service role full access
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'garmin_metrics'
          AND policyname = 'Service role can manage garmin_metrics'
    ) THEN
        CREATE POLICY "Service role can manage garmin_metrics" ON garmin_metrics
            FOR ALL
            USING (auth.role() = 'service_role');
    END IF;
END $$;


-- Admins read-only
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'garmin_metrics'
          AND policyname = 'Admins can view garmin_metrics'
    ) THEN
        CREATE POLICY "Admins can view garmin_metrics" ON garmin_metrics
            FOR SELECT
            USING (
                EXISTS (
                    SELECT 1 FROM mentors
                    WHERE mentors.user_id = auth.uid()
                      AND mentors.role = 'admin'
                )
            );
    END IF;
END $$;


-- Add source column to ingestion_logs
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'ingestion_logs' AND column_name = 'source'
    ) THEN
        ALTER TABLE ingestion_logs ADD COLUMN source text DEFAULT 'webhook';
    END IF;
END $$;
