-- Migration: Pseudonymize health data for PIPEDA compliance
--
-- Creates a participant_pseudonyms mapping table and migrates all health
-- tables from participant_id to pseudonym_id.  After this migration, a
-- database breach cannot link health data to real people without the
-- mapping table (which has the strictest RLS).

BEGIN;

-- =========================================================================
-- 1. Create the mapping table
-- =========================================================================
CREATE TABLE IF NOT EXISTS participant_pseudonyms (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE UNIQUE,
    pseudonym_id uuid DEFAULT gen_random_uuid() NOT NULL UNIQUE,
    created_at timestamptz DEFAULT now()
);

-- Populate for all existing participants
INSERT INTO participant_pseudonyms (participant_id)
SELECT id FROM participants
ON CONFLICT (participant_id) DO NOTHING;

-- =========================================================================
-- 2. Add pseudonym_id columns to all health tables (nullable first)
-- =========================================================================

-- garmin_metrics
ALTER TABLE garmin_metrics ADD COLUMN IF NOT EXISTS pseudonym_id uuid;

-- garmin_raw_dailies
ALTER TABLE garmin_raw_dailies ADD COLUMN IF NOT EXISTS pseudonym_id uuid;

-- garmin_raw_sleeps
ALTER TABLE garmin_raw_sleeps ADD COLUMN IF NOT EXISTS pseudonym_id uuid;

-- garmin_raw_hrv
ALTER TABLE garmin_raw_hrv ADD COLUMN IF NOT EXISTS pseudonym_id uuid;

-- garmin_tokens
ALTER TABLE garmin_tokens ADD COLUMN IF NOT EXISTS pseudonym_id uuid;

-- ingestion_logs
ALTER TABLE ingestion_logs ADD COLUMN IF NOT EXISTS pseudonym_id uuid;

-- =========================================================================
-- 3. Backfill pseudonym_id from the mapping table
-- =========================================================================

UPDATE garmin_metrics gm
SET pseudonym_id = pp.pseudonym_id
FROM participant_pseudonyms pp
WHERE gm.participant_id = pp.participant_id
  AND gm.pseudonym_id IS NULL;

UPDATE garmin_raw_dailies t
SET pseudonym_id = pp.pseudonym_id
FROM participant_pseudonyms pp
WHERE t.participant_id = pp.participant_id
  AND t.pseudonym_id IS NULL;

UPDATE garmin_raw_sleeps t
SET pseudonym_id = pp.pseudonym_id
FROM participant_pseudonyms pp
WHERE t.participant_id = pp.participant_id
  AND t.pseudonym_id IS NULL;

UPDATE garmin_raw_hrv t
SET pseudonym_id = pp.pseudonym_id
FROM participant_pseudonyms pp
WHERE t.participant_id = pp.participant_id
  AND t.pseudonym_id IS NULL;

UPDATE garmin_tokens t
SET pseudonym_id = pp.pseudonym_id
FROM participant_pseudonyms pp
WHERE t.participant_id = pp.participant_id
  AND t.pseudonym_id IS NULL;

UPDATE ingestion_logs t
SET pseudonym_id = pp.pseudonym_id
FROM participant_pseudonyms pp
WHERE t.participant_id = pp.participant_id
  AND t.pseudonym_id IS NULL;

-- =========================================================================
-- 4. Drop old participant_id columns from health tables
--    and add FK constraints on pseudonym_id
-- =========================================================================

-- garmin_metrics: drop old policies/constraints that reference participant_id
DROP POLICY IF EXISTS "Mentors can view assigned participant metrics" ON garmin_metrics;
DROP POLICY IF EXISTS "Service role can manage garmin_metrics" ON garmin_metrics;
DROP POLICY IF EXISTS "Admins can view garmin_metrics" ON garmin_metrics;
ALTER TABLE garmin_metrics DROP CONSTRAINT IF EXISTS garmin_metrics_participant_date_uq;
ALTER TABLE garmin_metrics DROP COLUMN IF EXISTS participant_id;
ALTER TABLE garmin_metrics ADD CONSTRAINT garmin_metrics_pseudonym_date_uq
    UNIQUE (pseudonym_id, metric_date);
ALTER TABLE garmin_metrics ADD CONSTRAINT garmin_metrics_pseudonym_fk
    FOREIGN KEY (pseudonym_id) REFERENCES participant_pseudonyms(pseudonym_id) ON DELETE CASCADE;

-- garmin_raw_dailies: drop old policies then column
DROP POLICY IF EXISTS "Service role can manage garmin_raw_dailies" ON garmin_raw_dailies;
DROP POLICY IF EXISTS "Admins can view garmin_raw_dailies" ON garmin_raw_dailies;
ALTER TABLE garmin_raw_dailies DROP COLUMN IF EXISTS participant_id;
ALTER TABLE garmin_raw_dailies ADD CONSTRAINT garmin_raw_dailies_pseudonym_fk
    FOREIGN KEY (pseudonym_id) REFERENCES participant_pseudonyms(pseudonym_id) ON DELETE CASCADE;

-- garmin_raw_sleeps: drop old policies then column
DROP POLICY IF EXISTS "Service role can manage garmin_raw_sleeps" ON garmin_raw_sleeps;
DROP POLICY IF EXISTS "Admins can view garmin_raw_sleeps" ON garmin_raw_sleeps;
ALTER TABLE garmin_raw_sleeps DROP COLUMN IF EXISTS participant_id;
ALTER TABLE garmin_raw_sleeps ADD CONSTRAINT garmin_raw_sleeps_pseudonym_fk
    FOREIGN KEY (pseudonym_id) REFERENCES participant_pseudonyms(pseudonym_id) ON DELETE CASCADE;

-- garmin_raw_hrv: drop old policies then column
DROP POLICY IF EXISTS "Service role can manage garmin_raw_hrv" ON garmin_raw_hrv;
DROP POLICY IF EXISTS "Admins can view garmin_raw_hrv" ON garmin_raw_hrv;
ALTER TABLE garmin_raw_hrv DROP COLUMN IF EXISTS participant_id;
ALTER TABLE garmin_raw_hrv ADD CONSTRAINT garmin_raw_hrv_pseudonym_fk
    FOREIGN KEY (pseudonym_id) REFERENCES participant_pseudonyms(pseudonym_id) ON DELETE CASCADE;

-- garmin_tokens: drop ALL old policies then column
DO $$ DECLARE pol RECORD; BEGIN
    FOR pol IN SELECT policyname FROM pg_policies WHERE tablename = 'garmin_tokens' LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON garmin_tokens', pol.policyname);
    END LOOP;
END $$;
ALTER TABLE garmin_tokens DROP COLUMN IF EXISTS participant_id;
ALTER TABLE garmin_tokens ADD CONSTRAINT garmin_tokens_pseudonym_fk
    FOREIGN KEY (pseudonym_id) REFERENCES participant_pseudonyms(pseudonym_id) ON DELETE CASCADE;

-- ingestion_logs: drop ALL old policies then column
DO $$ DECLARE pol RECORD; BEGIN
    FOR pol IN SELECT policyname FROM pg_policies WHERE tablename = 'ingestion_logs' LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON ingestion_logs', pol.policyname);
    END LOOP;
END $$;
ALTER TABLE ingestion_logs DROP COLUMN IF EXISTS participant_id;
ALTER TABLE ingestion_logs ADD CONSTRAINT ingestion_logs_pseudonym_fk
    FOREIGN KEY (pseudonym_id) REFERENCES participant_pseudonyms(pseudonym_id) ON DELETE CASCADE;

-- =========================================================================
-- 5. Add indexes on pseudonym_id
-- =========================================================================

DROP INDEX IF EXISTS idx_garmin_metrics_participant;
CREATE INDEX IF NOT EXISTS idx_garmin_metrics_pseudonym ON garmin_metrics(pseudonym_id);

DROP INDEX IF EXISTS idx_garmin_raw_dailies_participant;
CREATE INDEX IF NOT EXISTS idx_garmin_raw_dailies_pseudonym ON garmin_raw_dailies(pseudonym_id);

DROP INDEX IF EXISTS idx_garmin_raw_sleeps_participant;
CREATE INDEX IF NOT EXISTS idx_garmin_raw_sleeps_pseudonym ON garmin_raw_sleeps(pseudonym_id);

DROP INDEX IF EXISTS idx_garmin_raw_hrv_participant;
CREATE INDEX IF NOT EXISTS idx_garmin_raw_hrv_pseudonym ON garmin_raw_hrv(pseudonym_id);

CREATE INDEX IF NOT EXISTS idx_garmin_tokens_pseudonym ON garmin_tokens(pseudonym_id);
CREATE INDEX IF NOT EXISTS idx_ingestion_logs_pseudonym ON ingestion_logs(pseudonym_id);

-- =========================================================================
-- 6. RLS policies
-- =========================================================================

-- participant_pseudonyms: service_role ONLY (the critical isolation point)
ALTER TABLE participant_pseudonyms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role can manage participant_pseudonyms" ON participant_pseudonyms
    FOR ALL USING (auth.role() = 'service_role');

-- garmin_tokens: service_role only
ALTER TABLE garmin_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role can manage garmin_tokens" ON garmin_tokens
    FOR ALL USING (auth.role() = 'service_role');

-- garmin_metrics: re-create policies after column changes
CREATE POLICY "Service role can manage garmin_metrics" ON garmin_metrics
    FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Admins can view garmin_metrics" ON garmin_metrics
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM mentors WHERE mentors.user_id = auth.uid() AND mentors.role = 'admin')
    );

-- garmin_raw_dailies
CREATE POLICY "Service role can manage garmin_raw_dailies" ON garmin_raw_dailies
    FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Admins can view garmin_raw_dailies" ON garmin_raw_dailies
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM mentors WHERE mentors.user_id = auth.uid() AND mentors.role = 'admin')
    );

-- garmin_raw_sleeps
CREATE POLICY "Service role can manage garmin_raw_sleeps" ON garmin_raw_sleeps
    FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Admins can view garmin_raw_sleeps" ON garmin_raw_sleeps
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM mentors WHERE mentors.user_id = auth.uid() AND mentors.role = 'admin')
    );

-- garmin_raw_hrv
CREATE POLICY "Service role can manage garmin_raw_hrv" ON garmin_raw_hrv
    FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Admins can view garmin_raw_hrv" ON garmin_raw_hrv
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM mentors WHERE mentors.user_id = auth.uid() AND mentors.role = 'admin')
    );

-- ingestion_logs
ALTER TABLE ingestion_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role can manage ingestion_logs" ON ingestion_logs
    FOR ALL USING (auth.role() = 'service_role');

-- participants: ensure RLS is enabled
ALTER TABLE participants ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'participants' AND policyname = 'Service role can manage participants') THEN
        CREATE POLICY "Service role can manage participants" ON participants
            FOR ALL USING (auth.role() = 'service_role');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'participants' AND policyname = 'Admins can view participants') THEN
        CREATE POLICY "Admins can view participants" ON participants
            FOR SELECT USING (
                EXISTS (SELECT 1 FROM mentors WHERE mentors.user_id = auth.uid() AND mentors.role = 'admin')
            );
    END IF;
END $$;

COMMIT;
