-- Weekly report share links (public token URL) + SMS send tracking.
--
-- Share links are short-lived "secret links" intended for SMS delivery.
-- For the initial rollout, links expire 7 days after creation.

-- ============================================================
-- 1) Share links table
-- ============================================================
create table if not exists public.weekly_report_shares (
  id uuid primary key default gen_random_uuid(),
  weekly_report_id uuid not null references public.weekly_reports(id) on delete cascade,
  token text not null unique,
  is_active boolean not null default true,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_accessed_at timestamptz,
  access_count bigint not null default 0
);

create index if not exists weekly_report_shares_weekly_report_id_idx
  on public.weekly_report_shares (weekly_report_id);

create index if not exists weekly_report_shares_token_idx
  on public.weekly_report_shares (token);

create index if not exists weekly_report_shares_expires_at_idx
  on public.weekly_report_shares (expires_at);

alter table public.weekly_report_shares enable row level security;

-- Service role full access
do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'weekly_report_shares'
      and policyname = 'Service role can manage weekly_report_shares'
  ) then
    create policy "Service role can manage weekly_report_shares" on public.weekly_report_shares
      for all
      using (auth.role() = 'service_role');
  end if;
end $$;

-- Admins read/write (admin-only UI)
do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'weekly_report_shares'
      and policyname = 'Admins can manage weekly_report_shares'
  ) then
    create policy "Admins can manage weekly_report_shares" on public.weekly_report_shares
      for all
      using (
        exists (
          select 1 from public.mentors
          where mentors.user_id = auth.uid()
            and mentors.role = 'admin'
        )
      );
  end if;
end $$;

-- ============================================================
-- 2) Weekly reports: SMS tracking fields (separate from email status)
-- ============================================================
alter table public.weekly_reports
  add column if not exists sms_message_id uuid,
  add column if not exists sms_sent_at timestamptz,
  add column if not exists sms_last_error text;

-- Optional FK if sms_messages exists in this environment.
do $$
begin
  if to_regclass('public.sms_messages') is not null then
    begin
      alter table public.weekly_reports
        add constraint weekly_reports_sms_message_id_fk
        foreign key (sms_message_id) references public.sms_messages(id) on delete set null;
    exception
      when duplicate_object then
        null;
    end;
  end if;
end $$;

