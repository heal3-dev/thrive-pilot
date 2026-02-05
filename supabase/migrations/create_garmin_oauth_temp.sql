-- Create temporary table for storing OAuth 2.0 PKCE code verifiers
-- These are needed during the OAuth callback to exchange authorization code for access tokens
CREATE TABLE IF NOT EXISTS garmin_oauth_temp (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_token TEXT NOT NULL UNIQUE,
  code_verifier TEXT NOT NULL,
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast lookups by state_token (used in callback)
CREATE INDEX IF NOT EXISTS idx_garmin_oauth_temp_state 
  ON garmin_oauth_temp(state_token);

-- Index for cleanup of expired tokens
CREATE INDEX IF NOT EXISTS idx_garmin_oauth_temp_expires 
  ON garmin_oauth_temp(expires_at);

-- Cleanup function to delete expired OAuth temp data (run periodically via cron)
CREATE OR REPLACE FUNCTION cleanup_expired_oauth_tokens()
RETURNS void AS $$
BEGIN
  DELETE FROM garmin_oauth_temp WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- Comment explaining the table purpose
COMMENT ON TABLE garmin_oauth_temp IS 
  'Temporary storage for OAuth 2.0 PKCE code verifiers during Garmin authorization flow. Records expire after 30 minutes.';
