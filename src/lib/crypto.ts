import crypto from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Get encryption key from Supabase Vault (all environments)
 */
export async function getEncryptionKey(supabase: SupabaseClient): Promise<Buffer> {
  const { data, error } = await supabase
    .from('vault.decrypted_secrets')
    .select('decrypted_secret')
    .eq('name', 'garmin_token_encryption_key')
    .single();
  
  if (error || !data) {
    throw new Error('Failed to retrieve encryption key from Vault');
  }
  
  return Buffer.from(data.decrypted_secret, 'hex');
}

/**
 * Encrypt OAuth token using AES-256-GCM
 * @returns Encrypted string in format: iv:authTag:ciphertext
 */
export async function encryptToken(plaintext: string, supabase: SupabaseClient): Promise<string> {
  const key = await getEncryptionKey(supabase);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  // Format: iv:authTag:ciphertext
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt OAuth token
 * @param encrypted Encrypted string in format: iv:authTag:ciphertext
 */
export async function decryptToken(encrypted: string, supabase: SupabaseClient): Promise<string> {
  const key = await getEncryptionKey(supabase);
  const [ivHex, authTagHex, ciphertext] = encrypted.split(':');
  
  if (!ivHex || !authTagHex || !ciphertext) {
    throw new Error('Invalid encrypted token format');
  }
  
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

/**
 * Generate a new 256-bit encryption key (for one-time setup)
 * Run this once and store in Supabase Vault via SQL:
 * 
 * SELECT vault.create_secret(
 *   encode(gen_random_bytes(32), 'hex'),
 *   'garmin_token_encryption_key',
 *   'AES-256 encryption key for Garmin OAuth tokens'
 * );
 */
export function generateEncryptionKey(): string {
  return crypto.randomBytes(32).toString('hex');
}
