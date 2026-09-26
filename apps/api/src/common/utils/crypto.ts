import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Refresh tokens are opaque random strings, never JWTs: a JWT cannot be
 * revoked before it expires, and revocation is the whole point of a refresh
 * token. 48 random bytes is well past guessing range.
 */
export function generateOpaqueToken(bytes = 48): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Stores an HMAC of the token rather than the token itself, keyed by a server
 * -side pepper (JWT_REFRESH_SECRET). Consequences: a stolen database dump is
 * not replayable without the application secret, and lookup stays one indexed
 * query. Argon2 would be wrong here — the token already has 384 bits of
 * entropy, so there is nothing to brute force.
 */
export function hashToken(token: string, pepper: string): string {
  return createHmac('sha256', pepper).update(token).digest('hex');
}

/** Constant-time compare for equal-length hex digests. */
export function safeCompare(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/** `15m` / `7d` -> milliseconds. Mirrors the syntax accepted by @nestjs/jwt. */
export function durationToMs(duration: string): number {
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(duration);
  if (!match) throw new Error(`Unsupported duration: ${duration}`);

  const value = Number(match[1]);
  const unit = match[2] as 'ms' | 's' | 'm' | 'h' | 'd';
  const multipliers = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;
  return value * multipliers[unit];
}
