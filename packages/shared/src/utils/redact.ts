/**
 * Keys whose values must never reach a log line, an audit record or an error
 * payload. Extend this list rather than adding ad-hoc deletes at call sites.
 */
export const SENSITIVE_KEYS = [
  'password',
  // Row snapshots in the audit trail carry whole records, so the stored hash
  // columns have to be named here too - not just the plaintext fields.
  'passwordHash',
  'tokenHash',
  // A signature is a personal mark, not a secret — but a whole PNG in every
  // audit row helps nobody, and the trail only needs to say that it changed.
  'signatureData',
  'smtpPassword',
  'settingsSecret',
  'currentPassword',
  'newPassword',
  'confirmPassword',
  'token',
  'accessToken',
  'refreshToken',
  'authorization',
  'cookie',
  'secret',
  'apiKey',
  'creditCard',
] as const;

const SENSITIVE_SET = new Set<string>(SENSITIVE_KEYS.map((key) => key.toLowerCase()));

/**
 * Deep-clones `value` with sensitive keys replaced by `[REDACTED]`.
 * Cycles are cut so this is safe on request objects.
 */
export function redact<T>(value: T, depth = 6, seen = new WeakSet<object>()): T {
  if (depth < 0 || value === null || typeof value !== 'object') return value;

  // A Date has no own keys, so the copy below would turn it into `{}` — which
  // is how every date column in the audit trail used to be stored. It holds
  // nothing sensitive; hand it on for JSON to write as an ISO string.
  if (value instanceof Date) return value;

  const objectValue = value as unknown as object;
  if (seen.has(objectValue)) return '[CIRCULAR]' as unknown as T;
  seen.add(objectValue);

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth - 1, seen)) as unknown as T;
  }

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    output[key] = SENSITIVE_SET.has(key.toLowerCase()) ? '[REDACTED]' : redact(item, depth - 1, seen);
  }
  return output as unknown as T;
}
