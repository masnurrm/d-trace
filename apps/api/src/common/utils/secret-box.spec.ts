import { describe, expect, it } from 'vitest';
import { openSecret, sealSecret } from './secret-box.js';

const SECRET = 'a-settings-secret-that-is-long-enough-0000';

describe('secret-box', () => {
  it('round-trips a value', () => {
    const sealed = sealSecret('smtp-password', SECRET);
    expect(openSecret(sealed, SECRET)).toBe('smtp-password');
  });

  it('does not expose the plaintext in the ciphertext', () => {
    const sealed = sealSecret('smtp-password', SECRET);
    expect(sealed).not.toContain('smtp-password');
    expect(sealed.startsWith('v1:')).toBe(true);
  });

  it('produces a different ciphertext every time', () => {
    // A fresh IV per call; identical passwords must not look identical at rest.
    const first = sealSecret('same-value', SECRET);
    const second = sealSecret('same-value', SECRET);
    expect(first).not.toBe(second);
  });

  it('refuses to open with the wrong key', () => {
    const sealed = sealSecret('smtp-password', SECRET);
    expect(openSecret(sealed, 'a-different-secret-long-enough-11111111')).toBeNull();
  });

  it('refuses a tampered ciphertext instead of returning garbage', () => {
    // This is what the GCM auth tag buys: detection, not silent corruption.
    const sealed = sealSecret('smtp-password', SECRET);
    const parts = sealed.split(':');
    const flipped = `${parts[0]}:${parts[1]}:${parts[2]}:${parts[3]!.slice(0, -2)}AA`;

    expect(openSecret(flipped, SECRET)).toBeNull();
  });

  it('returns null for a value that is not in the expected format', () => {
    expect(openSecret('not-sealed', SECRET)).toBeNull();
    expect(openSecret('', SECRET)).toBeNull();
  });
});
