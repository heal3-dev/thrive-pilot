-- Up Migration
-- Email job queue for reliable sending + provider failover.

CREATE TABLE IF NOT EXISTS email_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  to_email text NOT NULL,
  subject text NOT NULL,
  html text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 8,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  provider text,
  provider_message_id text,
  last_error text,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_jobs_idempotency_key UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_email_jobs_status_next_attempt
  ON email_jobs(status, next_attempt_at ASC, created_at ASC);

-- Keep updated_at current
CREATE OR REPLACE FUNCTION set_email_jobs_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_email_jobs_set_updated_at ON email_jobs;
CREATE TRIGGER trg_email_jobs_set_updated_at
BEFORE UPDATE ON email_jobs
FOR EACH ROW
EXECUTE PROCEDURE set_email_jobs_updated_at();

-- Claim jobs safely in a single transaction (serverless-safe).
CREATE OR REPLACE FUNCTION claim_email_jobs(batch_size int, worker_id text)
RETURNS SETOF email_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT id
    FROM email_jobs
    WHERE status = 'pending'
      AND next_attempt_at <= now()
      AND attempts < max_attempts
    ORDER BY next_attempt_at ASC, created_at ASC
    LIMIT batch_size
    FOR UPDATE SKIP LOCKED
  )
  UPDATE email_jobs j
  SET status = 'sending',
      locked_at = now(),
      locked_by = worker_id,
      updated_at = now()
  FROM picked
  WHERE j.id = picked.id
  RETURNING j.*;
END;
$$;

ALTER TABLE email_jobs ENABLE ROW LEVEL SECURITY;

-- Service role full access (used by cron worker via getSupabaseAdmin()).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'email_jobs'
      AND policyname = 'Service role can manage email_jobs'
  ) THEN
    CREATE POLICY "Service role can manage email_jobs" ON email_jobs
      FOR ALL
      USING (auth.role() = 'service_role');
  END IF;
END $$;

