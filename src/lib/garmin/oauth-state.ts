import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const STATE_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface OAuthState {
  user_id: string;
  participant_id: string;
  nonce: string;
  expires_at: number;
}

/**
 * Get encryption key from environment
 * Uses a simple key derivation from service role key for OAuth state
 */
function getStateEncryptionKey(): Buffer {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for OAuth state encryption');
  }
  
  // Derive a 32-byte key from the service role key
  return crypto.createHash('sha256').update(secret).digest();
}

/**
 * Encrypt OAuth state data
 * @returns Encrypted string in format: iv:authTag:ciphertext
 */
function encryptState(state: OAuthState): string {
  const key = getStateEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  const plaintext = JSON.stringify(state);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  // Format: iv:authTag:ciphertext
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt OAuth state data
 * @param encrypted Encrypted string in format: iv:authTag:ciphertext
 */
function decryptState(encrypted: string): OAuthState {
  const key = getStateEncryptionKey();
  const [ivHex, authTagHex, ciphertext] = encrypted.split(':');
  
  if (!ivHex || !authTagHex || !ciphertext) {
    throw new Error('Invalid encrypted state format');
  }
  
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return JSON.parse(decrypted);
}

/**
 * Generate CSRF state token for OAuth flow
 * Returns encrypted state string (stored in garmin_oauth_temp DB table)
 */
export async function generateStateToken(params: {
  user_id: string;
  participant_id: string;
}): Promise<string> {
  const state: OAuthState = {
    user_id: params.user_id,
    participant_id: params.participant_id,
    nonce: crypto.randomUUID(),
    expires_at: Date.now() + STATE_TTL_MS,
  };
  
  return encryptState(state);
}

/**
 * Verify OAuth state token by decrypting and checking expiration.
 * State is verified against the garmin_oauth_temp DB record (looked up in callback).
 */
export async function verifyStateToken(stateToken: string): Promise<OAuthState | null> {
  try {
    // Decrypt and validate
    const state = decryptState(stateToken);
    
    // Check expiration
    if (Date.now() > state.expires_at) {
      return null;
    }
    
    return state;
  } catch (error) {
    console.error('[OAUTH_STATE] Verification failed:', error);
    return null;
  }
}

