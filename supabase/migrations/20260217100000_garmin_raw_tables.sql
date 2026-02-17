-- Migration: Create append-only raw ingestion tables for Garmin webhook payloads.
--
-- These tables preserve every webhook payload exactly as received.
-- garmin_metrics remains the merged "one row per day" view for the admin UI;
-- the raw tables are the safety net / audit trail.

-- ---------------------------------------------------------------------------
-- garmin_raw_dailies
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS garmin_raw_dailies (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    participant_id uuid REFERENCES participants(id) ON DELETE CASCADE,
    garmin_user_id text NOT NULL,
    summary_id text,
    calendar_date date NOT NULL,
    raw_data jsonb NOT NULL,
    created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_garmin_raw_dailies_participant
    ON garmin_raw_dailies(participant_id);
CREATE INDEX IF NOT EXISTS idx_garmin_raw_dailies_date
    ON garmin_raw_dailies(calendar_date DESC);

-- ---------------------------------------------------------------------------
-- garmin_raw_sleeps
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS garmin_raw_sleeps (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    participant_id uuid REFERENCES participants(id) ON DELETE CASCADE,
    garmin_user_id text NOT NULL,
    summary_id text,
    calendar_date date NOT NULL,
    raw_data jsonb NOT NULL,
    created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_garmin_raw_sleeps_participant
    ON garmin_raw_sleeps(participant_id);
CREATE INDEX IF NOT EXISTS idx_garmin_raw_sleeps_date
    ON garmin_raw_sleeps(calendar_date DESC);

-- ---------------------------------------------------------------------------
-- garmin_raw_hrv
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS garmin_raw_hrv (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    participant_id uuid REFERENCES participants(id) ON DELETE CASCADE,
    garmin_user_id text NOT NULL,
    summary_id text,
    calendar_date date NOT NULL,
    raw_data jsonb NOT NULL,
    created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_garmin_raw_hrv_participant
    ON garmin_raw_hrv(participant_id);
CREATE INDEX IF NOT EXISTS idx_garmin_raw_hrv_date
    ON garmin_raw_hrv(calendar_date DESC);

-- ---------------------------------------------------------------------------
-- RLS — same pattern as garmin_metrics
-- ---------------------------------------------------------------------------

ALTER TABLE garmin_raw_dailies ENABLE ROW LEVEL SECURITY;
ALTER TABLE garmin_raw_sleeps  ENABLE ROW LEVEL SECURITY;
ALTER TABLE garmin_raw_hrv     ENABLE ROW LEVEL SECURITY;

-- Service role full access
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'garmin_raw_dailies' AND policyname = 'Service role can manage garmin_raw_dailies') THEN
        CREATE POLICY "Service role can manage garmin_raw_dailies" ON garmin_raw_dailies FOR ALL USING (auth.role() = 'service_role');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'garmin_raw_sleeps' AND policyname = 'Service role can manage garmin_raw_sleeps') THEN
        CREATE POLICY "Service role can manage garmin_raw_sleeps" ON garmin_raw_sleeps FOR ALL USING (auth.role() = 'service_role');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'garmin_raw_hrv' AND policyname = 'Service role can manage garmin_raw_hrv') THEN
        CREATE POLICY "Service role can manage garmin_raw_hrv" ON garmin_raw_hrv FOR ALL USING (auth.role() = 'service_role');
    END IF;
END $$;

-- Admins read-only
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'garmin_raw_dailies' AND policyname = 'Admins can view garmin_raw_dailies') THEN
        CREATE POLICY "Admins can view garmin_raw_dailies" ON garmin_raw_dailies FOR SELECT
            USING (EXISTS (SELECT 1 FROM mentors WHERE mentors.user_id = auth.uid() AND mentors.role = 'admin'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'garmin_raw_sleeps' AND policyname = 'Admins can view garmin_raw_sleeps') THEN
        CREATE POLICY "Admins can view garmin_raw_sleeps" ON garmin_raw_sleeps FOR SELECT
            USING (EXISTS (SELECT 1 FROM mentors WHERE mentors.user_id = auth.uid() AND mentors.role = 'admin'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'garmin_raw_hrv' AND policyname = 'Admins can view garmin_raw_hrv') THEN
        CREATE POLICY "Admins can view garmin_raw_hrv" ON garmin_raw_hrv FOR SELECT
            USING (EXISTS (SELECT 1 FROM mentors WHERE mentors.user_id = auth.uid() AND mentors.role = 'admin'));
    END IF;
END $$;
