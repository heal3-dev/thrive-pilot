-- ============================================================
-- STEP 1: Corrected purge function (id-based, dynamic SQL)
-- ============================================================
create or replace function public.purge_garmin_retention(
  retention_raw_days  int default 14,
  retention_logs_days int default 30,
  batch_size          int default 5000
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cutoff_raw  timestamptz := now() - make_interval(days => retention_raw_days);
  cutoff_logs timestamptz := now() - make_interval(days => retention_logs_days);
  n           int;
  _tbl        text;
begin
  -- ── Raw tables: 14-day retention ──────────────────────────
  foreach _tbl in array array[
    'garmin_raw_dailies',
    'garmin_raw_stress',
    'garmin_raw_sleeps',
    'garmin_raw_hrv'
  ]
  loop
    loop
      execute format(
        'delete from public.%I
         where id in (
           select id from public.%I
           where created_at < $1
           limit $2
         )',
        _tbl, _tbl
      ) using cutoff_raw, batch_size;

      get diagnostics n = row_count;
      exit when n = 0;
      perform pg_sleep(0.05);
    end loop;

    -- Refresh planner stats after bulk delete
    execute format('analyze public.%I', _tbl);
  end loop;

  -- ── Ingestion logs: 30-day retention ──────────────────────
  loop
    delete from public.ingestion_logs
    where id in (
      select id from public.ingestion_logs
      where created_at < cutoff_logs
      limit batch_size
    );

    get diagnostics n = row_count;
    exit when n = 0;
    perform pg_sleep(0.05);
  end loop;

  analyze public.ingestion_logs;
end;
$$;

-- ============================================================
-- STEP 2: Schedule with pg_cron — Sundays at 3am UTC
--         (runs before Monday morning report generation)
-- ============================================================
select cron.schedule(
  'garmin-retention-purge',
  '0 3 * * 0',
  $$select public.purge_garmin_retention()$$
);;
