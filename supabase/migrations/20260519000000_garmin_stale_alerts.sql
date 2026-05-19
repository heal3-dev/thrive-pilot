-- Up Migration
-- Rate limiting for Garmin stale-metrics alerts + helper RPC.
--
-- Note: After pseudonymization, we can no longer join participants -> participant_pseudonyms
-- inside the database because participant_id is encrypted and the key lives in Vercel env vars.
-- This migration therefore rate-limits by pseudonym_id, and the helper RPC returns
-- participant_id_encrypted so the app can decrypt + load participant details.

CREATE TABLE IF NOT EXISTS garmin_stale_alerts (
  pseudonym_id uuid PRIMARY KEY REFERENCES participant_pseudonyms(pseudonym_id) ON DELETE CASCADE,
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

-- Helper RPC: returns connected pseudonyms with stale Garmin metrics and who haven't been alerted recently.
-- Connected means an active (non-revoked) garmin_tokens row exists for the pseudonym.
-- Staleness is based on the most recent garmin_metrics.updated_at for the pseudonym; if no metrics exist,
-- we fall back to the most recent garmin_tokens.created_at.
CREATE OR REPLACE FUNCTION get_garmin_stale_alert_candidates(
  stale_before timestamptz,
  resend_before timestamptz
)
RETURNS TABLE (
  pseudonym_id uuid,
  participant_id_encrypted text,
  garmin_connected_at timestamptz,
  last_metric_updated_at timestamptz,
  last_alerted_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH connected AS (
    SELECT
      gt.pseudonym_id,
      MAX(gt.created_at AT TIME ZONE 'UTC') AS garmin_connected_at,
      MAX(pp.participant_id_encrypted) AS participant_id_encrypted
    FROM garmin_tokens gt
    JOIN participant_pseudonyms pp ON pp.pseudonym_id = gt.pseudonym_id
    WHERE gt.revoked_at IS NULL
    GROUP BY gt.pseudonym_id
  ),
  last_metrics AS (
    SELECT gm.pseudonym_id, MAX(gm.updated_at) AS last_metric_updated_at
    FROM garmin_metrics gm
    JOIN connected c ON c.pseudonym_id = gm.pseudonym_id
    GROUP BY gm.pseudonym_id
  )
  SELECT
    c.pseudonym_id,
    c.participant_id_encrypted,
    c.garmin_connected_at,
    lm.last_metric_updated_at,
    gsa.last_alerted_at
  FROM connected c
  LEFT JOIN last_metrics lm ON lm.pseudonym_id = c.pseudonym_id
  LEFT JOIN garmin_stale_alerts gsa ON gsa.pseudonym_id = c.pseudonym_id
  WHERE COALESCE(lm.last_metric_updated_at, c.garmin_connected_at) IS NOT NULL
    AND COALESCE(lm.last_metric_updated_at, c.garmin_connected_at) < stale_before
    AND (gsa.last_alerted_at IS NULL OR gsa.last_alerted_at < resend_before);
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

