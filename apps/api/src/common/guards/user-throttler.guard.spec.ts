import { describe, expect, it } from 'vitest';
import { Reflector } from '@nestjs/core';
import type { ThrottlerModuleOptions, ThrottlerStorage } from '@nestjs/throttler';
import { ROLES } from '@dtrace/shared';
import { UserThrottlerGuard } from './user-throttler.guard.js';

/** Exposes the protected tracker so the keying rule can be asserted directly. */
class TestableGuard extends UserThrottlerGuard {
  track(req: Record<string, unknown>): Promise<string> {
    return this.getTracker(req);
  }
}

function createGuard(): TestableGuard {
  const options = {
    throttlers: [{ name: 'default', ttl: 60_000, limit: 300 }],
  } as unknown as ThrottlerModuleOptions;

  return new TestableGuard(options, {} as ThrottlerStorage, new Reflector());
}

const principal = {
  id: '1f1e4bfc-0a2a-4a1e-9f0f-2c6a0a3a1111',
  email: 'ada@dtrace.local',
  role: ROLES.ADMIN,
  sessionId: 'session-1',
};

describe('UserThrottlerGuard', () => {
  it('keys authenticated requests by user id', async () => {
    const tracker = await createGuard().track({ user: principal, ip: '127.0.0.1' });
    expect(tracker).toBe(`user:${principal.id}`);
  });

  it('gives two users on the same address separate buckets', async () => {
    // The point of the guard: every request reaches the API from the BFF's
    // single address, so keying on the address alone would pool everyone
    // into one budget and let one session throttle the rest.
    const guard = createGuard();
    const first = await guard.track({ user: principal, ip: '127.0.0.1' });
    const second = await guard.track({
      user: { ...principal, id: '2f2e4bfc-0a2a-4a1e-9f0f-2c6a0a3a2222' },
      ip: '127.0.0.1',
    });

    expect(first).not.toBe(second);
  });

  it('falls back to the address when there is no principal', async () => {
    // Sign-in and refresh are unauthenticated by definition; the address is
    // the only thing left to limit, and it is the brute-force surface.
    const tracker = await createGuard().track({ ip: '203.0.113.7' });
    expect(tracker).toMatch(/^ip:/);
    expect(tracker).toContain('203.0.113.7');
  });

  it('keeps the user and address namespaces apart', async () => {
    const guard = createGuard();
    const byUser = await guard.track({ user: principal, ip: '203.0.113.7' });
    const byIp = await guard.track({ ip: '203.0.113.7' });

    expect(byUser.startsWith('user:')).toBe(true);
    expect(byIp.startsWith('ip:')).toBe(true);
  });
});
