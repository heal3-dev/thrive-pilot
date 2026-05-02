-- Extend admin_db_usage() to:
-- - persist periodic snapshots of top tables for growth-rate calculations
-- - return growth deltas/rates (bytes and bytes/day) over the last 7 days
--
-- Backwards compatibility:
-- - Keeps legacy keys: db/public_schema + tables
-- - Also returns stable keys: totals + top_tables
-- - Growth fields are additive and may be null until enough snapshots exist

CREATE OR REPLACE FUNCTION public.admin_db_usage(top_n integer DEFAULT 25)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  _top_n integer := GREATEST(1, LEAST(COALESCE(top_n, 25), 200));
  _snapshot_n integer := LEAST(GREATEST(GREATEST(1, LEAST(COALESCE(top_n, 25), 200)), 25), 50);
  _now timestamptz := now();
  _window interval := interval '7 days';
  _min_snapshot_interval interval := interval '6 hours';
  _last_snapshot_at timestamptz;
  _db_bytes bigint := pg_database_size(current_database());
  _public_bytes bigint := (
    SELECT COALESCE(SUM(pg_total_relation_size(c.oid)), 0)
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r'
      AND n.nspname = 'public'
  );
  _db_growth_bytes_7d bigint;
  _db_growth_bytes_per_day_7d double precision;
  _tables jsonb;
BEGIN
  -- Snapshot de-duplication (global): only insert if we haven't captured recently.
  SELECT MAX(captured_at) INTO _last_snapshot_at
  FROM public.admin_db_usage_snapshots;

  IF _last_snapshot_at IS NULL OR (_now - _last_snapshot_at) > _min_snapshot_interval THEN
    INSERT INTO public.admin_db_usage_snapshots (
      captured_at,
      database_bytes,
      schema_name,
      table_name,
      total_bytes,
      table_bytes,
      index_bytes,
      toast_bytes,
      row_estimate
    )
    SELECT
      _now AS captured_at,
      _db_bytes AS database_bytes,
      n.nspname AS schema_name,
      c.relname AS table_name,
      pg_total_relation_size(c.oid) AS total_bytes,
      pg_relation_size(c.oid) AS table_bytes,
      pg_indexes_size(c.oid) AS index_bytes,
      (pg_total_relation_size(c.oid) - pg_relation_size(c.oid) - pg_indexes_size(c.oid)) AS toast_bytes,
      COALESCE(s.n_live_tup::bigint, c.reltuples::bigint, 0) AS row_estimate
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
    WHERE c.relkind = 'r'
      AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
    ORDER BY pg_total_relation_size(c.oid) DESC
    LIMIT _snapshot_n;
  END IF;

  -- Compute DB growth over window using historical snapshots.
  WITH db_snaps AS (
    SELECT captured_at, MAX(database_bytes) AS database_bytes
    FROM public.admin_db_usage_snapshots
    WHERE captured_at >= (_now - _window)
    GROUP BY captured_at
  ),
  first_snap AS (
    SELECT captured_at, database_bytes
    FROM db_snaps
    ORDER BY captured_at ASC
    LIMIT 1
  ),
  last_snap AS (
    SELECT captured_at, database_bytes
    FROM db_snaps
    ORDER BY captured_at DESC
    LIMIT 1
  )
  SELECT
    CASE
      WHEN (SELECT COUNT(*) FROM db_snaps) >= 2 THEN (last_snap.database_bytes - first_snap.database_bytes)
      ELSE NULL
    END AS growth_bytes,
    CASE
      WHEN (SELECT COUNT(*) FROM db_snaps) >= 2 AND EXTRACT(EPOCH FROM (last_snap.captured_at - first_snap.captured_at)) > 0
        THEN (last_snap.database_bytes - first_snap.database_bytes)
             / (EXTRACT(EPOCH FROM (last_snap.captured_at - first_snap.captured_at)) / 86400.0)
      ELSE NULL
    END AS growth_per_day
  INTO _db_growth_bytes_7d, _db_growth_bytes_per_day_7d
  FROM first_snap, last_snap;

  -- Build largest tables (and growth fields) once, reuse for both 'tables' and 'top_tables'.
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.total_bytes DESC), '[]'::jsonb)
  INTO _tables
  FROM (
    WITH top AS (
      SELECT
        n.nspname AS schema_name,
        c.relname AS table_name,
        COALESCE(s.n_live_tup::bigint, c.reltuples::bigint, 0) AS row_estimate,
        pg_total_relation_size(c.oid) AS total_bytes,
        pg_relation_size(c.oid) AS table_bytes,
        pg_indexes_size(c.oid) AS index_bytes,
        (pg_total_relation_size(c.oid) - pg_relation_size(c.oid) - pg_indexes_size(c.oid)) AS toast_bytes
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
      WHERE c.relkind = 'r'
        AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      ORDER BY pg_total_relation_size(c.oid) DESC
      LIMIT _top_n
    )
    SELECT
      top.schema_name,
      top.table_name,
      top.total_bytes,
      pg_size_pretty(top.total_bytes) AS total_pretty,
      top.table_bytes,
      pg_size_pretty(top.table_bytes) AS table_pretty,
      top.index_bytes,
      pg_size_pretty(top.index_bytes) AS index_pretty,
      top.toast_bytes,
      pg_size_pretty(top.toast_bytes) AS toast_pretty,
      top.row_estimate,
      g.growth_bytes_7d,
      g.growth_bytes_per_day_7d
    FROM top
    LEFT JOIN LATERAL (
      WITH snaps AS (
        SELECT captured_at, total_bytes
        FROM public.admin_db_usage_snapshots s
        WHERE s.schema_name = top.schema_name
          AND s.table_name = top.table_name
          AND s.captured_at >= (_now - _window)
        ORDER BY captured_at ASC
      ),
      first_snap AS (
        SELECT captured_at, total_bytes FROM snaps ORDER BY captured_at ASC LIMIT 1
      ),
      last_snap AS (
        SELECT captured_at, total_bytes FROM snaps ORDER BY captured_at DESC LIMIT 1
      )
      SELECT
        CASE
          WHEN (SELECT COUNT(*) FROM snaps) >= 2 THEN (last_snap.total_bytes - first_snap.total_bytes)
          ELSE NULL
        END AS growth_bytes_7d,
        CASE
          WHEN (SELECT COUNT(*) FROM snaps) >= 2 AND EXTRACT(EPOCH FROM (last_snap.captured_at - first_snap.captured_at)) > 0
            THEN (last_snap.total_bytes - first_snap.total_bytes)
                 / (EXTRACT(EPOCH FROM (last_snap.captured_at - first_snap.captured_at)) / 86400.0)
          ELSE NULL
        END AS growth_bytes_per_day_7d
      FROM first_snap, last_snap
    ) g ON TRUE
  ) t;

  RETURN jsonb_build_object(
    'captured_at', _now,

    -- Legacy shape (kept for compatibility with older API parsing)
    'db', jsonb_build_object(
      'name', current_database(),
      'size_bytes', _db_bytes,
      'size_pretty', pg_size_pretty(_db_bytes),
      'growth_bytes_7d', _db_growth_bytes_7d,
      'growth_bytes_per_day_7d', _db_growth_bytes_per_day_7d
    ),
    'public_schema', jsonb_build_object(
      'size_bytes', _public_bytes,
      'size_pretty', pg_size_pretty(_public_bytes)
    ),

    -- Stable app shape
    'totals', jsonb_build_object(
      'database_bytes', _db_bytes,
      'public_schema_bytes', _public_bytes,
      'database_growth_bytes_7d', _db_growth_bytes_7d,
      'database_growth_bytes_per_day_7d', _db_growth_bytes_per_day_7d
    ),

    -- Largest tables with growth fields.
    'tables', _tables,
    'top_tables', _tables
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_db_usage(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_db_usage(integer) TO service_role;

