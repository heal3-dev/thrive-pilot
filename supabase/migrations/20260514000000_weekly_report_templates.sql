-- Up Migration
-- Weekly report templates (prompt + HTML base template) with versioning.

CREATE TABLE IF NOT EXISTS weekly_report_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL,
  content text NOT NULL,
  version int NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Only one active template per key
CREATE UNIQUE INDEX IF NOT EXISTS weekly_report_templates_one_active_per_key
  ON weekly_report_templates(key)
  WHERE is_active;

CREATE INDEX IF NOT EXISTS idx_weekly_report_templates_key_version
  ON weekly_report_templates(key, version DESC, created_at DESC);

-- Keep updated_at current
CREATE OR REPLACE FUNCTION set_weekly_report_templates_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_weekly_report_templates_set_updated_at ON weekly_report_templates;
CREATE TRIGGER trg_weekly_report_templates_set_updated_at
BEFORE UPDATE ON weekly_report_templates
FOR EACH ROW
EXECUTE PROCEDURE set_weekly_report_templates_updated_at();

ALTER TABLE weekly_report_templates ENABLE ROW LEVEL SECURITY;

-- Service role full access (admin-only API routes use getSupabaseAdmin()).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'weekly_report_templates'
      AND policyname = 'Service role can manage weekly_report_templates'
  ) THEN
    CREATE POLICY "Service role can manage weekly_report_templates" ON weekly_report_templates
      FOR ALL
      USING (auth.role() = 'service_role');
  END IF;
END $$;

