-- Monthly reports persistence + send status tracking.
-- Stores the generated branded HTML per participant/month and allows admin approval + send tracking.

CREATE TABLE IF NOT EXISTS monthly_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  month_ending date NOT NULL,
  month_range text NOT NULL,
  badge_label text NOT NULL,
  badge_icon text NOT NULL,
  html text NOT NULL,
  outreach_text text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'queued', 'sent', 'failed')),
  approved_at timestamptz,
  queued_at timestamptz,
  sent_at timestamptz,
  last_error text,
  email_job_id uuid REFERENCES email_jobs(id) ON DELETE SET NULL,
  sms_message_id uuid,
  sms_sent_at timestamptz,
  sms_last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT monthly_reports_participant_month_unique UNIQUE (participant_id, month_ending)
);

-- Optional FK if sms_messages exists in this environment.
DO $$
BEGIN
  IF to_regclass('public.sms_messages') is not null THEN
    BEGIN
      ALTER TABLE public.monthly_reports
        ADD CONSTRAINT monthly_reports_sms_message_id_fk
        FOREIGN KEY (sms_message_id) REFERENCES public.sms_messages(id) ON DELETE SET NULL;
    EXCEPTION
      WHEN duplicate_object THEN
        NULL;
    END;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_monthly_reports_participant_month
  ON monthly_reports(participant_id, month_ending DESC);
CREATE INDEX IF NOT EXISTS idx_monthly_reports_status
  ON monthly_reports(status, updated_at DESC);

-- Keep updated_at current
CREATE OR REPLACE FUNCTION set_monthly_reports_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_monthly_reports_set_updated_at ON monthly_reports;
CREATE TRIGGER trg_monthly_reports_set_updated_at
  BEFORE UPDATE ON monthly_reports
  FOR EACH ROW
  EXECUTE PROCEDURE set_monthly_reports_updated_at();

ALTER TABLE monthly_reports ENABLE ROW LEVEL SECURITY;

-- Service role full access
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'monthly_reports'
      AND policyname = 'Service role can manage monthly_reports'
  ) THEN
    CREATE POLICY "Service role can manage monthly_reports" ON monthly_reports
      FOR ALL
      USING (auth.role() = 'service_role');
  END IF;
END $$;

-- Admins read/write (admin-only UI)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'monthly_reports'
      AND policyname = 'Admins can manage monthly_reports'
  ) THEN
    CREATE POLICY "Admins can manage monthly_reports" ON monthly_reports
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

-- Monthly report shares
CREATE TABLE IF NOT EXISTS public.monthly_report_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  monthly_report_id uuid NOT NULL REFERENCES public.monthly_reports(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  last_accessed_at timestamptz,
  access_count bigint NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS monthly_report_shares_monthly_report_id_idx
  ON public.monthly_report_shares (monthly_report_id);
CREATE INDEX IF NOT EXISTS monthly_report_shares_token_idx
  ON public.monthly_report_shares (token);
CREATE INDEX IF NOT EXISTS monthly_report_shares_expires_at_idx
  ON public.monthly_report_shares (expires_at);

ALTER TABLE public.monthly_report_shares ENABLE ROW LEVEL SECURITY;

-- Service role full access
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'monthly_report_shares'
      AND policyname = 'Service role can manage monthly_report_shares'
  ) THEN
    CREATE POLICY "Service role can manage monthly_report_shares" ON public.monthly_report_shares
      FOR ALL
      USING (auth.role() = 'service_role');
  END IF;
END $$;

-- Admins read/write (admin-only UI)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'monthly_report_shares'
      AND policyname = 'Admins can manage monthly_report_shares'
  ) THEN
    CREATE POLICY "Admins can manage monthly_report_shares" ON public.monthly_report_shares
      FOR ALL
      USING (
        EXISTS (
          SELECT 1 FROM public.mentors
          WHERE mentors.user_id = auth.uid()
            and mentors.role = 'admin'
        )
      );
  END IF;
END $$;
