import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { AuthenticatedUser } from '../types/authenticated-request.js';

/**
 * Rate limiting keyed by *identity*, falling back to IP.
 *
 * Why this exists: the API's only client is the Next.js BFF, so every
 * authenticated request arrives from the same address — the web server's.
 * Stock IP-based throttling therefore puts every user in one shared bucket,
 * which means a single busy session can lock out everyone else. That is not a
 * theoretical risk; it is what produced `ThrottlerException` during ordinary
 * development, with one browser open.
 *
 * Tracking authenticated traffic per user id fixes that: one user's activity
 * can no longer exhaust another's budget. Unauthenticated traffic (login,
 * register, refresh) still falls back to the IP, which is exactly where
 * IP-based limiting belongs — that is the brute-force surface.
 *
 * Note this guard must run *after* `JwtAuthGuard`, since it reads the
 * principal that guard attaches. See the ordering note in `app.module.ts`.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const user = req['user'] as AuthenticatedUser | undefined;
    if (user?.id) return `user:${user.id}`;

    // Delegates to the base implementation, which handles IPv6 subnet grouping
    // so a client with a /64 cannot mint a fresh bucket per address.
    const ip = await super.getTracker(req);
    return `ip:${ip}`;
  }
}
