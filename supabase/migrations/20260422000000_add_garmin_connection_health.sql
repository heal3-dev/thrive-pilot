-- Migration: Add garmin connection health tracking
--
-- Tracks last successful Garmin ingestion per pseudonym_id and when we last
-- alerted the participant about a potential sync stop.
--
-- This enables proactive "please reconnect" outreach when data stops arriving.

BEGIN;

CREATE TABLE IF NOT EXISTS garmin_connection_health (
  pseudonym_id uuid PRIMARY KEY
    REFERENCES participant_pseudonyms(pseudonym_id) ON DELETE CASCADE,

  -- Last time we successfully processed any Garmin data for this participant
  last_success_at timestamptz,
  last_calendar_date date,
  last_source text, -- e.g. webhook-dailies, webhook-sleeps, webhook-hrv, webhook-stress

  -- Outbound alerting to participants (to avoid spamming)
  last_alert_sent_at timestamptz,
  last_alert_type text, -- e.g. reconnect, nudge

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_garmin_conn_health_last_success
  ON garmin_connection_health (last_success_at DESC);

CREATE INDEX IF NOT EXISTS idx_garmin_conn_health_last_alert
  ON garmin_connection_health (last_alert_sent_at DESC);

-- Auto-update updated_at on row changes
CREATE OR REPLACE FUNCTION update_garmin_connection_health_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_garmin_connection_health_updated_at ON garmin_connection_health;
CREATE TRIGGER trg_garmin_connection_health_updated_at
  BEFORE UPDATE ON garmin_connection_health
  FOR EACH ROW
  EXECUTE FUNCTION update_garmin_connection_health_updated_at();

-- RLS: service role only (health/ops table)
ALTER TABLE garmin_connection_health ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'garmin_connection_health'
      AND policyname = 'Service role can manage garmin_connection_health'
  ) THEN
    CREATE POLICY "Service role can manage garmin_connection_health"
      ON garmin_connection_health
      FOR ALL
      USING (auth.role() = 'service_role');
  END IF;
END $$;

COMMIT;

