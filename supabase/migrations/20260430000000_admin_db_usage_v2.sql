-- Align admin_db_usage() output with the /api/admin/db-usage + /db-usage UI.
--
-- The UI expects:
-- - totals: { database_bytes, public_schema_bytes }
-- - top_tables: [{ schema_name, table_name, total_bytes, table_bytes, index_bytes, toast_bytes, row_estimate }]
--
-- This migration keeps the same function name and signature, but changes its
-- JSON keys to the stable shape consumed by the app.
--
-- Note: SECURITY DEFINER is intentionally used so the function can safely read
-- pg_catalog stats/size functions even when called via Supabase RPC.

CREATE OR REPLACE FUNCTION public.admin_db_usage(top_n integer DEFAULT 25)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  _top_n integer := GREATEST(1, LEAST(COALESCE(top_n, 25), 200));
BEGIN
  RETURN jsonb_build_object(
    'captured_at', now(),
    'totals', jsonb_build_object(
      'database_bytes', pg_database_size(current_database()),
      'public_schema_bytes', (
        SELECT COALESCE(SUM(pg_total_relation_size(c.oid)), 0)
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r'
          AND n.nspname = 'public'
      )
    ),
    'top_tables', (
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.total_bytes DESC), '[]'::jsonb)
      FROM (
        SELECT
          n.nspname AS schema_name,
          c.relname AS table_name,
          COALESCE(s.n_live_tup::bigint, c.reltuples::bigint, 0) AS row_estimate,
          pg_total_relation_size(c.oid) AS total_bytes,
          pg_relation_size(c.oid) AS table_bytes,
          pg_indexes_size(c.oid) AS index_bytes,
          pg_total_relation_size(c.oid) - pg_relation_size(c.oid) - pg_indexes_size(c.oid) AS toast_bytes
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
        WHERE c.relkind = 'r'
          AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
        ORDER BY pg_total_relation_size(c.oid) DESC
        LIMIT _top_n
      ) t
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_db_usage(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_db_usage(integer) TO service_role;

