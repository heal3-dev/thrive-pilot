-- Migration: Store Garmin stressDetails payloads + body battery time series
--
-- Adds:
-- 1) `garmin_raw_stress` append-only table for HEALTH - Stress webhook/backfill payloads
-- 2) `garmin_metrics.body_battery_time_offset_values` to persist `timeOffsetBodyBatteryValues`
-- 3) `garmin_metrics.body_battery_start` derived "start of day" body battery

-- ---------------------------------------------------------------------------
-- garmin_raw_stress (append-only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS garmin_raw_stress (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    pseudonym_id uuid REFERENCES participant_pseudonyms(pseudonym_id) ON DELETE CASCADE,
    garmin_user_id text NOT NULL,
    summary_id text,
    calendar_date date NOT NULL,
    raw_data jsonb NOT NULL,
    created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_garmin_raw_stress_pseudonym
    ON garmin_raw_stress(pseudonym_id);
CREATE INDEX IF NOT EXISTS idx_garmin_raw_stress_date
    ON garmin_raw_stress(calendar_date DESC);

ALTER TABLE garmin_raw_stress ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE tablename = 'garmin_raw_stress'
        AND policyname = 'Service role can manage garmin_raw_stress'
    ) THEN
        CREATE POLICY "Service role can manage garmin_raw_stress" ON garmin_raw_stress
            FOR ALL USING (auth.role() = 'service_role');
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE tablename = 'garmin_raw_stress'
        AND policyname = 'Admins can view garmin_raw_stress'
    ) THEN
        CREATE POLICY "Admins can view garmin_raw_stress" ON garmin_raw_stress
            FOR SELECT USING (
                EXISTS (
                    SELECT 1 FROM mentors
                    WHERE mentors.user_id = auth.uid()
                      AND mentors.role = 'admin'
                )
            );
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- garmin_metrics additions
-- ---------------------------------------------------------------------------
ALTER TABLE garmin_metrics
  ADD COLUMN IF NOT EXISTS body_battery_time_offset_values jsonb;

ALTER TABLE garmin_metrics
  ADD COLUMN IF NOT EXISTS body_battery_start int;

