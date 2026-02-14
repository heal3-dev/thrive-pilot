-- Add Garmin-related actions to the audit_logs action check constraint.
-- Existing allowed actions: read, create, update, delete, export, consent_given, opt_out

ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_action_check;

ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_action_check CHECK (
  action = ANY (ARRAY[
    'read'::text, 'create'::text, 'update'::text, 'delete'::text,
    'export'::text, 'consent_given'::text, 'opt_out'::text,
    'garmin_connected'::text, 'garmin_disconnected'::text,
    'garmin_token_refreshed'::text, 'garmin_token_revoked'::text
  ])
);
