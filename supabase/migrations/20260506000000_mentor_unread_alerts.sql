-- Up Migration
-- Adds a simple rate-limit table for mentor inbound-message email alerts.

CREATE TABLE IF NOT EXISTS mentor_unread_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mentor_id uuid NOT NULL REFERENCES mentors(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  last_alerted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mentor_unread_alerts_mentor_participant_key UNIQUE (mentor_id, participant_id)
);

CREATE INDEX IF NOT EXISTS idx_mentor_unread_alerts_last_alerted_at
  ON mentor_unread_alerts(last_alerted_at DESC);

-- Keep updated_at current
-- Use a dedicated function name to avoid collisions with other migrations.
CREATE OR REPLACE FUNCTION set_mentor_unread_alerts_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_mentor_unread_alerts_set_updated_at ON mentor_unread_alerts;
CREATE TRIGGER trg_mentor_unread_alerts_set_updated_at
BEFORE UPDATE ON mentor_unread_alerts
FOR EACH ROW
EXECUTE PROCEDURE set_mentor_unread_alerts_updated_at();

ALTER TABLE mentor_unread_alerts ENABLE ROW LEVEL SECURITY;

-- Service role full access (used by webhook code via getSupabaseAdmin())
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'mentor_unread_alerts'
      AND policyname = 'Service role can manage mentor_unread_alerts'
  ) THEN
    CREATE POLICY "Service role can manage mentor_unread_alerts" ON mentor_unread_alerts
      FOR ALL
      USING (auth.role() = 'service_role');
  END IF;
END $$;

