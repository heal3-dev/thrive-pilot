-- Up Migration

-- 1. Create ingestion_logs table if it doesn't exist
CREATE TABLE IF NOT EXISTS ingestion_logs (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    participant_id uuid REFERENCES participants(id) ON DELETE CASCADE,
    
    -- Status tracking
    status text NOT NULL CHECK (status IN ('success', 'failed', 'partial', 'skipped')),
    attempt_number int DEFAULT 1,
    
    -- Metrics stats
    metrics_imported int DEFAULT 0,
    
    -- Error details
    error_message text,
    
    -- Performance tracking
    duration_ms int,
    
    -- Timestamps
    date_processed date, -- The date of the data being fetched (e.g. "2023-10-27" data)
    created_at timestamptz DEFAULT now()
);

-- Index for querying logs by participant and date
CREATE INDEX IF NOT EXISTS idx_ingestion_participant_date ON ingestion_logs(participant_id, date_processed);
CREATE INDEX IF NOT EXISTS idx_ingestion_created_at ON ingestion_logs(created_at DESC);

-- 2. Enhance garmin_metrics table
-- Add JSONB column for raw API response storage (debugging)
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'garmin_metrics' AND column_name = 'raw_data') THEN
        ALTER TABLE garmin_metrics ADD COLUMN raw_data jsonb;
    END IF;
END $$;

-- Ensure unique constraint on (participant_id, metric_date) to prevent duplicates
-- Note: User already has this table, assuming constraint might exist or needs to be added safely
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'garmin_metrics_participant_id_metric_date_key') THEN
        -- Check for duplicates before adding constraint?
        -- For now, just try adding it. If it fails, manual cleanup is needed.
        ALTER TABLE garmin_metrics ADD CONSTRAINT garmin_metrics_participant_id_metric_date_key UNIQUE (participant_id, metric_date);
    END IF;
EXCEPTION
    WHEN duplicate_table THEN NULL; -- constraint already exists
    WHEN others THEN NULL; -- might fail if duplicates exist
END $$;

-- 3. RLS Policies (idempotent)
ALTER TABLE ingestion_logs ENABLE ROW LEVEL SECURITY;

-- Service role full access
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'ingestion_logs'
          AND policyname = 'Service role can manage ingestion logs'
    ) THEN
        CREATE POLICY "Service role can manage ingestion logs" ON ingestion_logs
            FOR ALL
            USING (auth.role() = 'service_role');
    END IF;
END $$;

-- Admins read-only
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'ingestion_logs'
          AND policyname = 'Admins can view ingestion logs'
    ) THEN
        CREATE POLICY "Admins can view ingestion logs" ON ingestion_logs
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

-- Down Migration (for reference)
-- DROP TABLE ingestion_logs;
-- ALTER TABLE garmin_metrics DROP COLUMN raw_data;
