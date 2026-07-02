-- migration to add weekly/monthly report email notification preference
ALTER TABLE participants ADD COLUMN weekly_report_email_enabled BOOLEAN DEFAULT TRUE;
