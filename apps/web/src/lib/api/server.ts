import 'server-only';
import { cache } from 'react';
import {
  ERROR_CODES,
  type ApiError,
  type ApiResponse,
  type PaginationMeta,
  type SessionUser,
} from '@dtrace/shared';
import { apiBaseUrl } from '../config/env';
import { getAccessToken } from '../auth/session';

export interface ApiResult<T> {
  data: T;
  meta?: PaginationMeta;
}

/**
 * Thrown for any non-2xx response. It carries the API's stable error `code`,
 * so callers branch on `code`, never on a human-readable message.
 */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: { field: string; message: string }[],
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }

  /** True when the API never answered — it is down, not refusing. */
  get isUnreachable(): boolean {
    return this.code === ERROR_CODES.SERVICE_UNAVAILABLE;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isExpiredSession(): boolean {
    return (
      this.code === ERROR_CODES.TOKEN_EXPIRED ||
      this.code === ERROR_CODES.SESSION_REVOKED ||
      this.code === ERROR_CODES.UNAUTHORIZED
    );
  }
}

export interface ApiFetchOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Send the caller's access token. Off for public endpoints. */
  authenticated?: boolean;
  /** Passed through to Next's fetch cache. Defaults to no caching. */
  revalidate?: number | false;
  tags?: string[];
}

/**
 * The single server-side entry point to the API.
 *
 * Everything that touches the API from the server goes through here, so the
 * auth header, the response envelope and error translation are implemented
 * once instead of per call site.
 */
export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<ApiResult<T>> {
  const { body, authenticated = true, revalidate, tags, headers, ...init } = options;

  const requestHeaders = new Headers(headers);
  requestHeaders.set('Accept', 'application/json');

  if (body !== undefined && !requestHeaders.has('Content-Type')) {
    requestHeaders.set('Content-Type', 'application/json');
  }

  if (authenticated) {
    const token = await getAccessToken();
    if (!token) {
      throw new ApiRequestError(401, ERROR_CODES.UNAUTHORIZED, 'No active session');
    }
    requestHeaders.set('Authorization', `Bearer ${token}`);
  }

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
      // Authenticated data must never land in a shared cache by accident.
      cache: revalidate === undefined ? 'no-store' : undefined,
      next: revalidate === undefined ? undefined : { revalidate, tags },
    });
  } catch {
    // fetch throws a bare TypeError when the host refuses or times out. Turn it
    // into the same typed error every other failure uses, so callers can decide
    // what to show instead of the framework printing a stack trace.
    throw new ApiRequestError(
      503,
      ERROR_CODES.SERVICE_UNAVAILABLE,
      `API tidak dapat dihubungi di ${apiBaseUrl}`,
    );
  }

  if (response.status === 204) {
    return { data: undefined as T };
  }

  const payload = (await response.json().catch(() => null)) as ApiResponse<T> | null;

  if (!response.ok || !payload || payload.success === false) {
    const error = payload as ApiError | null;
    throw new ApiRequestError(
      response.status,
      error?.error?.code ?? ERROR_CODES.INTERNAL_ERROR,
      error?.error?.message ?? 'The request failed',
      error?.error?.details,
      error?.requestId,
    );
  }

  return { data: payload.data, meta: payload.meta };
}

/**
 * The authenticated principal for the current render.
 *
 * `cache()` deduplicates it per request, so a layout, a page and three
 * components can each ask "who is signed in" and only one HTTP call is made.
 * Returns null instead of throwing, so callers decide whether to redirect.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  try {
    const result = await apiFetch<SessionUser>('/auth/me');
    return result.data;
  } catch (error) {
    if (error instanceof ApiRequestError && error.isUnauthorized) return null;
    throw error;
  }
});
