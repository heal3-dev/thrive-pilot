/**
 * Pseudonym Encryption Utilities
 *
 * Encrypts/decrypts participant_id in the participant_pseudonyms table
 * so a database dump cannot link health data to real people.
 *
 * Key: PSEUDONYM_ENCRYPTION_KEY (256-bit hex string, Vercel env var only)
 * Hash: HMAC-SHA256 for deterministic lookups (same input = same hash)
 * Encryption: AES-256-GCM for reversible decryption (IV + auth tag + ciphertext)
 */

import crypto from 'crypto';

function getKey(): Buffer {
  const hex = process.env.PSEUDONYM_ENCRYPTION_KEY;
  if (!hex) {
    throw new Error('PSEUDONYM_ENCRYPTION_KEY env var is required');
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Compute a deterministic HMAC-SHA256 hash of a participant_id.
 * Used for WHERE clause lookups — same input always produces same hash,
 * but the hash is irreversible without the key.
 */
export function hashParticipantId(participantId: string): string {
  return crypto.createHmac('sha256', getKey()).update(participantId).digest('hex');
}

/**
 * Encrypt a participant_id using AES-256-GCM.
 * Returns base64(IV + authTag + ciphertext).
 * Each call produces a different output (random IV) for the same input.
 */
export function encryptParticipantId(participantId: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(participantId, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

/**
 * Decrypt a participant_id that was encrypted with encryptParticipantId.
 * Input: base64(IV + authTag + ciphertext).
 */
export function decryptParticipantId(encrypted: string): string {
  const buf = Buffer.from(encrypted, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
  decipher.setAuthTag(tag);
  return decipher.update(data, undefined, 'utf8') + decipher.final('utf8');
}
