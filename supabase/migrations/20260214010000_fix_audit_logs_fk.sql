-- Fix audit_logs foreign key constraint to allow Participants to log actions.
-- Currently, audit_logs.user_id references mentors.id, which fails for Participants.
-- Both Mentors and Participants are auth.users, so we should reference auth.users(id).

ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_user_id_fkey;

-- Recreate constraint pointing to auth.users
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_user_id_fkey 
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
