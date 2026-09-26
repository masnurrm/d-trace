import 'server-only';
import type { ApiError, SessionUser } from '@dtrace/shared';
import { apiBaseUrl } from '../config/env';
import { extractUpstreamRefreshToken } from './session';

export interface UpstreamAuthSuccess {
  ok: true;
  user: SessionUser;
  accessToken: string;
  expiresIn: number;
  refreshToken?: string;
}

export interface UpstreamAuthFailure {
  ok: false;
  status: number;
  body: ApiError;
}

/**
 * Calls a credential endpoint (`/auth/login`, `/auth/register`) and unpacks
 * both halves of the response: the JSON envelope and the refresh cookie that
 * only exists in the `Set-Cookie` header.
 *
 * Failures are returned rather than thrown, and the API's error body is passed
 * through untouched - the browser gets the same stable codes and field-level
 * details the API produced, with no message rewriting in between.
 */
export async function authenticateUpstream(
  path: '/auth/login' | '/auth/register',
  body: unknown,
  forwardedFor?: string | null,
): Promise<UpstreamAuthSuccess | UpstreamAuthFailure> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      // Lets the API rate-limit and audit the real client, not this server.
      // The API only honours it when TRUST_PROXY is enabled.
      ...(forwardedFor ? { 'X-Forwarded-For': forwardedFor } : {}),
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });

  const payload = (await response.json().catch(() => null)) as
    | { success: true; data: { user: SessionUser; accessToken: string; expiresIn: number } }
    | ApiError
    | null;

  if (!response.ok || !payload || payload.success === false) {
    return {
      ok: false,
      status: response.status,
      body:
        payload && payload.success === false
          ? payload
          : {
              success: false,
              error: { code: 'INTERNAL_ERROR', message: 'Authentication service unavailable' },
              requestId: '',
              timestamp: new Date().toISOString(),
            },
    };
  }

  return {
    ok: true,
    user: payload.data.user,
    accessToken: payload.data.accessToken,
    expiresIn: payload.data.expiresIn,
    refreshToken: extractUpstreamRefreshToken(response.headers.getSetCookie()),
  };
}
