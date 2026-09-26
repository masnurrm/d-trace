import type { CookieOptions } from 'express';

/** Refresh token cookie. Access tokens are never persisted in a cookie. */
export const REFRESH_COOKIE_NAME = 'dtrace_rt';

export interface CookieConfig {
  secure: boolean;
  sameSite: 'lax' | 'strict' | 'none';
  domain?: string;
}

/**
 * `httpOnly` keeps the token away from XSS; `path` scopes it so it is only
 * ever sent to the refresh/logout endpoints, not to every API call.
 */
export function refreshCookieOptions(config: CookieConfig, maxAgeMs: number): CookieOptions {
  return {
    httpOnly: true,
    secure: config.secure,
    sameSite: config.sameSite,
    domain: config.domain,
    path: '/',
    maxAge: maxAgeMs,
    signed: true,
  };
}

export function clearedRefreshCookieOptions(config: CookieConfig): CookieOptions {
  return {
    httpOnly: true,
    secure: config.secure,
    sameSite: config.sameSite,
    domain: config.domain,
    path: '/',
    signed: true,
  };
}
