import crypto from 'crypto';
import { cookies } from 'next/headers';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const STATE_COOKIE_NAME = 'garmin_oauth_state';
const STATE_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface OAuthState {
  user_id: string;
  participant_id: string;
  nonce: string;
  expires_at: number;
}

/**
 * Get encryption key from environment
 * Uses a simple key derivation from session secret for OAuth state
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
 * Encrypts state and stores in HttpOnly cookie
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
  
  const encryptedState = encryptState(state);
  
  // Store in HttpOnly cookie
  const cookieStore = await cookies();
  cookieStore.set(STATE_COOKIE_NAME, encryptedState, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: STATE_TTL_MS / 1000, // Convert to seconds
    path: '/',
  });
  
  return encryptedState;
}

/**
 * Verify and retrieve OAuth state from cookie
 * Validates expiration and removes cookie after use
 */
export async function verifyStateToken(stateToken: string): Promise<OAuthState | null> {
  try {
    const cookieStore = await cookies();
    const storedState = cookieStore.get(STATE_COOKIE_NAME)?.value;
    
    // Verify state matches what's in cookie (CSRF protection)
    if (!storedState || storedState !== stateToken) {
      return null;
    }
    
    // Decrypt and validate
    const state = decryptState(stateToken);
    
    // Check expiration
    if (Date.now() > state.expires_at) {
      return null;
    }
    
    // Delete cookie after successful verification (one-time use)
    cookieStore.delete(STATE_COOKIE_NAME);
    
    return state;
  } catch (error) {
    console.error('[OAUTH_STATE] Verification failed:', error);
    return null;
  }
}
