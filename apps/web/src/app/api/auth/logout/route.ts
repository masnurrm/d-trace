import { NextResponse } from 'next/server';
import { apiBaseUrl } from '@/lib/config/env';
import {
  UPSTREAM_REFRESH_COOKIE,
  clearSessionCookies,
  getRefreshToken,
} from '@/lib/auth/session';

/**
 * Sign-out.
 *
 * The local cookies are cleared no matter what happens upstream: if the API is
 * unreachable, the user must still end up signed out in the browser rather
 * than stuck in a session they explicitly asked to leave.
 */
export async function POST(): Promise<NextResponse> {
  const refreshToken = await getRefreshToken();

  if (refreshToken) {
    // Best effort: this is what actually revokes the session server-side.
    await fetch(`${apiBaseUrl}/auth/logout`, {
      method: 'POST',
      headers: { Cookie: `${UPSTREAM_REFRESH_COOKIE}=${encodeURIComponent(refreshToken)}` },
      cache: 'no-store',
    }).catch(() => undefined);
  }

  await clearSessionCookies();

  return NextResponse.json({ success: true, data: { loggedOut: true } });
}
