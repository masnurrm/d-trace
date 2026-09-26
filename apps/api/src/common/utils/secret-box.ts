import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

/**
 * Authenticated encryption for the few secrets that must be stored and later
 * used, rather than merely verified — currently only the SMTP password.
 *
 * AES-256-GCM, not a hash: the application has to recover the plaintext to
 * authenticate against the mail server. GCM's auth tag means a tampered
 * ciphertext fails to decrypt instead of silently producing garbage.
 *
 * The key is derived from SETTINGS_SECRET with scrypt. Rotating that secret
 * makes every stored value undecryptable, which is the intended blast radius:
 * the operator re-enters the password.
 */
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const SALT = 'dtrace.settings.v1';
const PREFIX = 'v1';

function deriveKey(secret: string): Buffer {
  return scryptSync(secret, SALT, KEY_LENGTH);
}

/** Returns `v1:<iv>:<authTag>:<ciphertext>`, all base64url. */
export function sealSecret(plaintext: string, secret: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, deriveKey(secret), iv);

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [PREFIX, iv.toString('base64url'), authTag.toString('base64url'), ciphertext.toString('base64url')].join(
    ':',
  );
}

/**
 * Returns null rather than throwing when the value cannot be opened — a secret
 * encrypted under a rotated key is a configuration problem to surface calmly,
 * not a crash in the middle of sending mail.
 */
export function openSecret(sealed: string, secret: string): string | null {
  const parts = sealed.split(':');
  if (parts.length !== 4 || parts[0] !== PREFIX) return null;

  try {
    const [, iv, authTag, ciphertext] = parts as [string, string, string, string];
    const decipher = createDecipheriv(ALGORITHM, deriveKey(secret), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(authTag, 'base64url'));

    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}
