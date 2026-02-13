-- Migration: Add columns to garmin_tokens for token refresh & connection health
-- Ticket 2.4: Token Refresh & Connection Health

-- 1. Add `updated_at` column for tracking when credentials were last refreshed
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'garmin_tokens' AND column_name = 'updated_at'
    ) THEN
        ALTER TABLE garmin_tokens
            ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
    END IF;
END $$;

-- 2. Add `revocation_reason` column for storing why a token was revoked
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'garmin_tokens' AND column_name = 'revocation_reason'
    ) THEN
        ALTER TABLE garmin_tokens
            ADD COLUMN revocation_reason TEXT;
    END IF;
END $$;

-- 3. Auto-update `updated_at` on any row change via trigger
CREATE OR REPLACE FUNCTION update_garmin_tokens_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop and recreate to ensure idempotency
DROP TRIGGER IF EXISTS trg_garmin_tokens_updated_at ON garmin_tokens;
CREATE TRIGGER trg_garmin_tokens_updated_at
    BEFORE UPDATE ON garmin_tokens
    FOR EACH ROW
    EXECUTE FUNCTION update_garmin_tokens_updated_at();

-- 4. Index on revoked_at to speed up "find active tokens" queries
CREATE INDEX IF NOT EXISTS idx_garmin_tokens_active
    ON garmin_tokens (participant_id)
    WHERE revoked_at IS NULL;

-- 5. Index on participant_id + created_at for "latest token" lookups
CREATE INDEX IF NOT EXISTS idx_garmin_tokens_participant_latest
    ON garmin_tokens (participant_id, created_at DESC);
