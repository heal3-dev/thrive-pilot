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

-- Helper RPC: returns connected participants with stale Garmin metrics and who haven't been alerted recently.
-- We consider a participant "connected" if either:
-- - participants.garmin_user_id is set, OR
-- - there's an active row in garmin_tokens (revoked_at is null) for their pseudonym_id
--
-- Staleness is based on the most recent garmin_metrics.updated_at for the pseudonym_id; if no metrics exist,
-- we fall back to participants.garmin_connected_at.
CREATE OR REPLACE FUNCTION get_garmin_stale_alert_candidates(
  stale_before timestamptz,
  resend_before timestamptz
)
RETURNS TABLE (
  participant_id uuid,
  pseudonym_id uuid,
  name text,
  email text,
  phone_number text,
  garmin_user_id text,
  garmin_connected_at timestamptz,
  last_metric_updated_at timestamptz,
  last_alerted_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH connected AS (
    SELECT DISTINCT
      p.id AS participant_id,
      pp.pseudonym_id AS pseudonym_id,
      p.name,
      p.email,
      p.phone_number,
      p.garmin_user_id,
      p.garmin_connected_at
    FROM participants p
    LEFT JOIN participant_pseudonyms pp ON pp.participant_id = p.id
    LEFT JOIN garmin_tokens gt
      ON gt.pseudonym_id = pp.pseudonym_id
     AND gt.revoked_at IS NULL
    WHERE (p.is_active IS NULL OR p.is_active = true)
      AND (
        p.garmin_user_id IS NOT NULL
        OR gt.pseudonym_id IS NOT NULL
      )
      AND pp.pseudonym_id IS NOT NULL
  ),
  last_metrics AS (
    SELECT gm.pseudonym_id, MAX(gm.updated_at) AS last_metric_updated_at
    FROM garmin_metrics gm
    JOIN connected c ON c.pseudonym_id = gm.pseudonym_id
    GROUP BY gm.pseudonym_id
  )
  SELECT
    c.participant_id,
    c.pseudonym_id,
    c.name,
    c.email,
    c.phone_number,
    c.garmin_user_id,
    c.garmin_connected_at,
    lm.last_metric_updated_at,
    gsa.last_alerted_at
  FROM connected c
  LEFT JOIN last_metrics lm ON lm.pseudonym_id = c.pseudonym_id
  LEFT JOIN garmin_stale_alerts gsa ON gsa.participant_id = c.participant_id
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

