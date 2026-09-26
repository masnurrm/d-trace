import { describe, expect, it } from 'vitest';
import { durationToMs, generateOpaqueToken, hashToken, safeCompare } from './crypto.js';

describe('generateOpaqueToken', () => {
  it('produces url-safe tokens with at least 256 bits of entropy', () => {
    const token = generateOpaqueToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThanOrEqual(43);
  });

  it('never repeats', () => {
    const tokens = new Set(Array.from({ length: 500 }, () => generateOpaqueToken()));
    expect(tokens.size).toBe(500);
  });
});

describe('hashToken', () => {
  it('is deterministic for the same token and pepper', () => {
    expect(hashToken('token', 'pepper')).toBe(hashToken('token', 'pepper'));
  });

  it('yields a different digest under a different pepper', () => {
    // This is what makes rotating JWT_REFRESH_SECRET revoke every session.
    expect(hashToken('token', 'pepper-a')).not.toBe(hashToken('token', 'pepper-b'));
  });

  it('does not leak the token itself', () => {
    const digest = hashToken('super-secret-token', 'pepper');
    expect(digest).not.toContain('super-secret-token');
    expect(digest).toHaveLength(64);
  });
});

describe('safeCompare', () => {
  it('matches identical strings and rejects everything else', () => {
    expect(safeCompare('abc', 'abc')).toBe(true);
    expect(safeCompare('abc', 'abd')).toBe(false);
    expect(safeCompare('abc', 'abcd')).toBe(false);
  });
});

describe('durationToMs', () => {
  it('converts every supported unit', () => {
    expect(durationToMs('500ms')).toBe(500);
    expect(durationToMs('30s')).toBe(30_000);
    expect(durationToMs('15m')).toBe(900_000);
    expect(durationToMs('2h')).toBe(7_200_000);
    expect(durationToMs('7d')).toBe(604_800_000);
  });

  it('throws on anything it cannot parse, rather than defaulting', () => {
    // A silent fallback here would quietly hand out tokens with the wrong TTL.
    expect(() => durationToMs('7 days')).toThrow();
    expect(() => durationToMs('')).toThrow();
  });
});
