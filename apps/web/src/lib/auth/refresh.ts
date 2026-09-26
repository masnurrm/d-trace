import { UPSTREAM_REFRESH_COOKIE, extractUpstreamRefreshToken } from './session';
import { apiBaseUrl } from '../config/env';

export interface RefreshedSession {
  accessToken: string;
  expiresIn: number;
  refreshToken?: string;
}

/**
 * Exchanges a refresh token for a new pair, by hand rather than through
 * `apiFetch`.
 *
 * Two reasons this is standalone: it must run in middleware (which cannot use
 * `next/headers`), and it must read the upstream `Set-Cookie` header, which the
 * envelope-parsing helper deliberately hides.
 *
 * Returns null on any failure. A failed refresh is not an error to surface - it
 * means "this session is over", and the caller sends the user to sign in again.
 */
export async function refreshSession(
  refreshToken: string,
  clientIp?: string | null,
): Promise<RefreshedSession | null> {
  try {
    const response = await fetch(`${apiBaseUrl}/auth/refresh`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        // Re-encode: the value was decoded on the way in, and the API verifies
        // the cookie signature over the encoded form.
        Cookie: `${UPSTREAM_REFRESH_COOKIE}=${encodeURIComponent(refreshToken)}`,
        // /auth/refresh is rate limited by address upstream; without this every
        // refresh in the system would share this server's one bucket.
        ...(clientIp ? { 'X-Forwarded-For': clientIp } : {}),
      },
      cache: 'no-store',
    });

    if (!response.ok) return null;

    const payload = (await response.json()) as {
      success: boolean;
      data?: { accessToken: string; expiresIn: number };
    };

    if (!payload.success || !payload.data) return null;

    // The API rotates on every refresh, so there is always a new cookie here.
    // If it is missing we keep the old one rather than dropping the session.
    const rotated = extractUpstreamRefreshToken(response.headers.getSetCookie());

    return {
      accessToken: payload.data.accessToken,
      expiresIn: payload.data.expiresIn,
      refreshToken: rotated ?? refreshToken,
    };
  } catch {
    return null;
  }
}
