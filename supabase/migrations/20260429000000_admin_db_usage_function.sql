-- Admin-only DB usage function (for free-tier monitoring).
-- Returns database size and largest tables by total bytes.
--
-- Notes:
-- - This function is intended to be called via the service_role key from a
--   server-side admin API route.
-- - We revoke execute from PUBLIC and grant only to service_role.
--
-- Usage (Supabase RPC):
--   select public.admin_db_usage(25);

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
    'db', jsonb_build_object(
      'name', current_database(),
      'size_bytes', pg_database_size(current_database()),
      'size_pretty', pg_size_pretty(pg_database_size(current_database()))
    ),
    'tables', (
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.total_bytes DESC), '[]'::jsonb)
      FROM (
        SELECT
          n.nspname AS schema,
          c.relname AS table,
          pg_total_relation_size(c.oid) AS total_bytes,
          pg_relation_size(c.oid) AS table_bytes,
          (pg_total_relation_size(c.oid) - pg_relation_size(c.oid)) AS index_bytes,
          pg_size_pretty(pg_total_relation_size(c.oid)) AS total_pretty,
          pg_size_pretty(pg_relation_size(c.oid)) AS table_pretty,
          pg_size_pretty(pg_total_relation_size(c.oid) - pg_relation_size(c.oid)) AS index_pretty,
          COALESCE(s.n_live_tup::bigint, c.reltuples::bigint, 0) AS approx_rows,
          s.last_vacuum,
          s.last_autovacuum,
          s.last_analyze,
          s.last_autoanalyze
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

