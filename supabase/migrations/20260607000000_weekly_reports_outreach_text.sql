-- Persist the outreach text shown in the admin UI so SMS sends can match it exactly.

ALTER TABLE weekly_reports
  ADD COLUMN IF NOT EXISTS outreach_text text;

