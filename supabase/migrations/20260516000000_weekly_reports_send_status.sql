-- Weekly reports persistence + send status tracking.
-- Stores the generated branded HTML per participant/week and allows admin approval + send tracking.

CREATE TABLE IF NOT EXISTS weekly_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  week_ending date NOT NULL,
  week_range text NOT NULL,
  badge_label text NOT NULL,
  badge_icon text NOT NULL,
  html text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'queued', 'sent', 'failed')),
  approved_at timestamptz,
  queued_at timestamptz,
  sent_at timestamptz,
  last_error text,
  email_job_id uuid REFERENCES email_jobs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT weekly_reports_participant_week_unique UNIQUE (participant_id, week_ending)
);

CREATE INDEX IF NOT EXISTS idx_weekly_reports_participant_week
  ON weekly_reports(participant_id, week_ending DESC);
CREATE INDEX IF NOT EXISTS idx_weekly_reports_status
  ON weekly_reports(status, updated_at DESC);

-- Keep updated_at current
CREATE OR REPLACE FUNCTION set_weekly_reports_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_weekly_reports_set_updated_at ON weekly_reports;
CREATE TRIGGER trg_weekly_reports_set_updated_at
BEFORE UPDATE ON weekly_reports
FOR EACH ROW
EXECUTE PROCEDURE set_weekly_reports_updated_at();

ALTER TABLE weekly_reports ENABLE ROW LEVEL SECURITY;

-- Service role full access
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'weekly_reports'
      AND policyname = 'Service role can manage weekly_reports'
  ) THEN
    CREATE POLICY "Service role can manage weekly_reports" ON weekly_reports
      FOR ALL
      USING (auth.role() = 'service_role');
  END IF;
END $$;

-- Admins read/write (admin-only UI)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'weekly_reports'
      AND policyname = 'Admins can manage weekly_reports'
  ) THEN
    CREATE POLICY "Admins can manage weekly_reports" ON weekly_reports
      FOR ALL
      USING (
        EXISTS (
          SELECT 1 FROM mentors
          WHERE mentors.user_id = auth.uid()
            AND mentors.role = 'admin'
        )
      );
  END IF;
END $$;

