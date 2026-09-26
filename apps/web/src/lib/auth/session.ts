import 'server-only';
import { cookies } from 'next/headers';

/**
 * Session cookies owned by this app (the BFF), not by the API.
 *
 * Both are `httpOnly`, so no script running in the page can read them - which
 * is what makes an XSS bug non-fatal here: an attacker can act *as* the page
 * while it is open, but cannot steal a token and replay it later.
 */
export const ACCESS_COOKIE = 'dtrace_at';
export const REFRESH_COOKIE = 'dtrace_rt';

/** The API's own cookie name, used when proxying a refresh call upstream. */
export const UPSTREAM_REFRESH_COOKIE = 'dtrace_rt';

const isProduction = process.env.NODE_ENV === 'production';

const baseCookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: isProduction,
  path: '/',
} as const;

export interface SessionTokens {
  accessToken: string;
  /** Seconds until the access token expires, as reported by the API. */
  expiresIn: number;
  refreshToken?: string;
}

/**
 * The access cookie is deliberately given the token's own lifetime: when it
 * expires the browser drops it, and middleware sees "no access cookie, but a
 * refresh cookie" - which is exactly the signal to refresh.
 * The 30s skew stops a request being sent with a token that expires in flight.
 */
export function accessCookieMaxAge(expiresIn: number): number {
  return Math.max(30, expiresIn - 30);
}

export async function getAccessToken(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(ACCESS_COOKIE)?.value;
}

export async function getRefreshToken(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(REFRESH_COOKIE)?.value;
}

export async function hasSession(): Promise<boolean> {
  const store = await cookies();
  return Boolean(store.get(ACCESS_COOKIE) ?? store.get(REFRESH_COOKIE));
}

/** Only callable from a route handler or server action. */
export async function writeSessionCookies(tokens: SessionTokens): Promise<void> {
  const store = await cookies();

  store.set(ACCESS_COOKIE, tokens.accessToken, {
    ...baseCookieOptions,
    maxAge: accessCookieMaxAge(tokens.expiresIn),
  });

  if (tokens.refreshToken) {
    store.set(REFRESH_COOKIE, tokens.refreshToken, {
      ...baseCookieOptions,
      // The API decides the real lifetime; this is an upper bound for the jar.
      maxAge: 60 * 60 * 24 * 7,
    });
  }
}

export async function clearSessionCookies(): Promise<void> {
  const store = await cookies();
  store.delete(ACCESS_COOKIE);
  store.delete(REFRESH_COOKIE);
}

/**
 * Pulls the API's refresh cookie out of an upstream `Set-Cookie` header so the
 * BFF can re-issue it on its own origin. The value is forwarded verbatim,
 * signature included, so the API can still verify it.
 */
export function extractUpstreamRefreshToken(setCookieHeaders: string[]): string | undefined {
  for (const header of setCookieHeaders) {
    const [pair] = header.split(';');
    if (!pair) continue;

    const separator = pair.indexOf('=');
    if (separator === -1) continue;

    if (pair.slice(0, separator).trim() === UPSTREAM_REFRESH_COOKIE) {
      return decodeURIComponent(pair.slice(separator + 1).trim());
    }
  }
  return undefined;
}
