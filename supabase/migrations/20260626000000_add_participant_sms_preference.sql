-- migration to add weekly report sms notification preference
ALTER TABLE participants ADD COLUMN weekly_report_sms_enabled BOOLEAN DEFAULT TRUE;
