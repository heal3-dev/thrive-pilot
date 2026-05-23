-- Log weekly Garmin retention purge runs so the admin DB Usage page can show:
-- - last purge time
-- - retention policy used
-- - estimated bytes deleted (logical cleanup)
-- - on-disk bytes reclaimed (often ~0 until vacuum)

-- ============================================================
-- 1) Audit tables for retention purge runs
-- ============================================================
create table if not exists public.garmin_retention_purge_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  error text,
  retention_raw_days int not null,
  retention_logs_days int not null,
  batch_size int not null
);

create index if not exists garmin_retention_purge_runs_started_at_idx
  on public.garmin_retention_purge_runs (started_at desc);

create table if not exists public.garmin_retention_purge_run_tables (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.garmin_retention_purge_runs(id) on delete cascade,
  schema_name text not null,
  table_name text not null,
  cutoff timestamptz not null,
  deleted_rows bigint not null default 0,
  before_total_bytes bigint,
  after_total_bytes bigint,
  estimated_deleted_bytes bigint,
  reclaimed_bytes bigint,
  created_at timestamptz not null default now()
);

create index if not exists garmin_retention_purge_run_tables_run_id_idx
  on public.garmin_retention_purge_run_tables (run_id);

alter table public.garmin_retention_purge_runs enable row level security;
alter table public.garmin_retention_purge_run_tables enable row level security;

revoke all on table public.garmin_retention_purge_runs from public;
revoke all on table public.garmin_retention_purge_run_tables from public;

grant select on table public.garmin_retention_purge_runs to service_role;
grant select on table public.garmin_retention_purge_run_tables to service_role;

-- ============================================================
-- 2) Wrapper: run purge and persist summary + per-table stats
-- ============================================================
create or replace function public.run_garmin_retention_purge_and_log(
  retention_raw_days  int default 14,
  retention_logs_days int default 30,
  batch_size          int default 5000
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  run_id uuid;
  cutoff_raw  timestamptz := now() - make_interval(days => retention_raw_days);
  cutoff_logs timestamptz := now() - make_interval(days => retention_logs_days);
  _tbl text;
  _cutoff timestamptz;
  n int;
  deleted_total bigint;
  reg regclass;
  before_total bigint;
  after_total bigint;
  before_rows bigint;
  est_deleted bigint;
begin
  insert into public.garmin_retention_purge_runs (
    retention_raw_days,
    retention_logs_days,
    batch_size
  )
  values (retention_raw_days, retention_logs_days, batch_size)
  returning id into run_id;

  -- ── Raw tables: retention_raw_days ────────────────────────
  foreach _tbl in array array[
    'garmin_raw_dailies',
    'garmin_raw_stress',
    'garmin_raw_sleeps',
    'garmin_raw_hrv'
  ]
  loop
    _cutoff := cutoff_raw;
    deleted_total := 0;
    reg := to_regclass(format('%I.%I', 'public', _tbl));
    if reg is null then
      continue;
    end if;

    before_total := pg_total_relation_size(reg);
    select coalesce(s.n_live_tup::bigint, c.reltuples::bigint, 0)
      into before_rows
      from pg_class c
      left join pg_stat_user_tables s on s.relid = c.oid
      where c.oid = reg;

    loop
      execute format(
        'delete from public.%I
         where id in (
           select id from public.%I
           where created_at < $1
           limit $2
         )',
        _tbl, _tbl
      ) using _cutoff, batch_size;

      get diagnostics n = row_count;
      deleted_total := deleted_total + n;
      exit when n = 0;
      perform pg_sleep(0.05);
    end loop;

    execute format('analyze public.%I', _tbl);
    after_total := pg_total_relation_size(reg);

    est_deleted :=
      case
        when before_rows > 0 and deleted_total > 0
          then greatest(0, ((before_total::numeric / before_rows) * deleted_total))::bigint
        else 0
      end;

    insert into public.garmin_retention_purge_run_tables (
      run_id,
      schema_name,
      table_name,
      cutoff,
      deleted_rows,
      before_total_bytes,
      after_total_bytes,
      estimated_deleted_bytes,
      reclaimed_bytes
    )
    values (
      run_id,
      'public',
      _tbl,
      _cutoff,
      deleted_total,
      before_total,
      after_total,
      est_deleted,
      greatest(0, before_total - after_total)
    );
  end loop;

  -- ── Ingestion logs: retention_logs_days ───────────────────
  _tbl := 'ingestion_logs';
  _cutoff := cutoff_logs;
  deleted_total := 0;
  reg := to_regclass('public.ingestion_logs');

  if reg is not null then
    before_total := pg_total_relation_size(reg);
    select coalesce(s.n_live_tup::bigint, c.reltuples::bigint, 0)
      into before_rows
      from pg_class c
      left join pg_stat_user_tables s on s.relid = c.oid
      where c.oid = reg;

    loop
      delete from public.ingestion_logs
      where id in (
        select id from public.ingestion_logs
        where created_at < _cutoff
        limit batch_size
      );

      get diagnostics n = row_count;
      deleted_total := deleted_total + n;
      exit when n = 0;
      perform pg_sleep(0.05);
    end loop;

    analyze public.ingestion_logs;
    after_total := pg_total_relation_size(reg);

    est_deleted :=
      case
        when before_rows > 0 and deleted_total > 0
          then greatest(0, ((before_total::numeric / before_rows) * deleted_total))::bigint
        else 0
      end;

    insert into public.garmin_retention_purge_run_tables (
      run_id,
      schema_name,
      table_name,
      cutoff,
      deleted_rows,
      before_total_bytes,
      after_total_bytes,
      estimated_deleted_bytes,
      reclaimed_bytes
    )
    values (
      run_id,
      'public',
      _tbl,
      _cutoff,
      deleted_total,
      before_total,
      after_total,
      est_deleted,
      greatest(0, before_total - after_total)
    );
  end if;

  update public.garmin_retention_purge_runs
  set status = 'success',
      finished_at = now()
  where id = run_id;

  return run_id;
exception
  when others then
    update public.garmin_retention_purge_runs
    set status = 'error',
        error = sqlerrm,
        finished_at = now()
    where id = run_id;
    raise;
end;
$$;

revoke all on function public.run_garmin_retention_purge_and_log(int, int, int) from public;
grant execute on function public.run_garmin_retention_purge_and_log(int, int, int) to service_role;

-- ============================================================
-- 3) Ensure the cron uses the logging wrapper
-- ============================================================
do $$
declare
  jid int;
begin
  begin
    select jobid into jid from cron.job where jobname = 'garmin-retention-purge';
    if jid is not null then
      perform cron.unschedule(jid);
    end if;
  exception
    when undefined_table or invalid_schema_name or undefined_function then
      null;
  end;

  begin
    perform cron.schedule(
      'garmin-retention-purge',
      '0 3 * * 0',
      $cmd$select public.run_garmin_retention_purge_and_log()$cmd$
    );
  exception
    when others then
      -- If cron isn't available in a given environment, migrations should still apply.
      null;
  end;
end $$;

-- ============================================================
-- 4) Extend admin_db_usage() to include last purge summary
-- ============================================================
create or replace function public.admin_db_usage(top_n integer default 25)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  _top_n integer := greatest(1, least(coalesce(top_n, 25), 200));
  last_run record;
  last_totals record;
begin
  select
    r.id,
    r.started_at,
    r.finished_at,
    r.status,
    r.retention_raw_days,
    r.retention_logs_days,
    coalesce(sum(t.deleted_rows), 0)::bigint as rows_deleted,
    coalesce(sum(t.estimated_deleted_bytes), 0)::bigint as estimated_deleted_bytes,
    coalesce(sum(t.reclaimed_bytes), 0)::bigint as reclaimed_bytes
  into last_totals
  from public.garmin_retention_purge_runs r
  left join public.garmin_retention_purge_run_tables t on t.run_id = r.id
  where r.status = 'success'
  group by r.id, r.started_at, r.finished_at, r.status, r.retention_raw_days, r.retention_logs_days
  order by r.started_at desc
  limit 1;

  return jsonb_build_object(
    'captured_at', now(),
    'totals', jsonb_build_object(
      'database_bytes', pg_database_size(current_database()),
      'public_schema_bytes', (
        select coalesce(sum(pg_total_relation_size(c.oid)), 0)
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where c.relkind = 'r'
          and n.nspname = 'public'
      )
    ),
    'top_tables', (
      select coalesce(jsonb_agg(to_jsonb(t) order by t.total_bytes desc), '[]'::jsonb)
      from (
        select
          n.nspname as schema_name,
          c.relname as table_name,
          coalesce(s.n_live_tup::bigint, c.reltuples::bigint, 0) as row_estimate,
          pg_total_relation_size(c.oid) as total_bytes,
          pg_relation_size(c.oid) as table_bytes,
          pg_indexes_size(c.oid) as index_bytes,
          pg_total_relation_size(c.oid) - pg_relation_size(c.oid) - pg_indexes_size(c.oid) as toast_bytes
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        left join pg_stat_user_tables s on s.relid = c.oid
        where c.relkind = 'r'
          and n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
        order by pg_total_relation_size(c.oid) desc
        limit _top_n
      ) t
    ),
    'retention_purge', (
      case
        when last_totals.id is null then null
        else jsonb_build_object(
          'run_id', last_totals.id,
          'started_at', last_totals.started_at,
          'finished_at', last_totals.finished_at,
          'retention_raw_days', last_totals.retention_raw_days,
          'retention_logs_days', last_totals.retention_logs_days,
          'rows_deleted', last_totals.rows_deleted,
          'estimated_deleted_bytes', last_totals.estimated_deleted_bytes,
          'reclaimed_bytes', last_totals.reclaimed_bytes
        )
      end
    )
  );
end;
$$;

revoke all on function public.admin_db_usage(integer) from public;
grant execute on function public.admin_db_usage(integer) to service_role;

