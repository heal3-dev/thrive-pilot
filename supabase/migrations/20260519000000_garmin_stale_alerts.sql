-- Up Migration
-- Per-participant rate limiting for Garmin stale-metrics alerts + helper RPC.

CREATE TABLE IF NOT EXISTS garmin_stale_alerts (
  participant_id uuid PRIMARY KEY REFERENCES participants(id) ON DELETE CASCADE,
  pseudonym_id uuid,
  last_metric_updated_at timestamptz,
  last_alerted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_garmin_stale_alerts_last_alerted_at
  ON garmin_stale_alerts(last_alerted_at DESC);

-- Keep updated_at current
CREATE OR REPLACE FUNCTION set_garmin_stale_alerts_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_garmin_stale_alerts_set_updated_at ON garmin_stale_alerts;
CREATE TRIGGER trg_garmin_stale_alerts_set_updated_at
BEFORE UPDATE ON garmin_stale_alerts
FOR EACH ROW
EXECUTE PROCEDURE set_garmin_stale_alerts_updated_at();

-- NOTE: participant_pseudonyms no longer stores plaintext participant_id in production.
-- Any logic that needs to map participants ↔ pseudonyms must do so in application code
-- by decrypting participant_id_encrypted (requires PSEUDONYM_ENCRYPTION_KEY, which is not
-- available inside the database).
--
-- Helper RPC: given a list of pseudonym_ids, return the latest garmin_metrics.updated_at
-- for each pseudonym.
DROP FUNCTION IF EXISTS get_garmin_metrics_last_updated(uuid[]);
CREATE OR REPLACE FUNCTION get_garmin_metrics_last_updated(
  pseudonym_ids uuid[]
)
RETURNS TABLE (
  pseudonym_id uuid,
  last_metric_updated_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    gm.pseudonym_id,
    MAX(gm.updated_at) AS last_metric_updated_at
  FROM garmin_metrics gm
  WHERE gm.pseudonym_id = ANY(pseudonym_ids)
  GROUP BY gm.pseudonym_id;
$$;

ALTER TABLE garmin_stale_alerts ENABLE ROW LEVEL SECURITY;

-- Service role full access (used by cron via getSupabaseAdmin()).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'garmin_stale_alerts'
      AND policyname = 'Service role can manage garmin_stale_alerts'
  ) THEN
    CREATE POLICY "Service role can manage garmin_stale_alerts" ON garmin_stale_alerts
      FOR ALL
      USING (auth.role() = 'service_role');
  END IF;
END $$;

