import type { ApiFieldError, ApiResponse, PaginationMeta } from '@dtrace/shared';

/**
 * Browser-side counterpart to `apiFetch`. It talks to this app's BFF routes,
 * never to the API directly, so no credential ever exists in client code -
 * there is nothing here for an XSS payload to steal.
 */
export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: ApiFieldError[],
  ) {
    super(message);
    this.name = 'ApiClientError';
  }

  /** Maps field-level errors onto react-hook-form's `setError` shape. */
  get fieldErrors(): Record<string, string> {
    const entries = (this.details ?? []).map((detail) => [detail.field, detail.message] as const);
    return Object.fromEntries(entries);
  }
}

export interface ClientFetchOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  searchParams?: Record<string, string | number | boolean | undefined>;
}

export interface ClientResult<T> {
  data: T;
  meta?: PaginationMeta;
}

export async function clientFetch<T>(
  path: string,
  options: ClientFetchOptions = {},
): Promise<ClientResult<T>> {
  const { body, searchParams, headers, ...init } = options;

  const url = new URL(`/api/bff${path.startsWith('/') ? path : `/${path}`}`, window.location.origin);
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }

  const requestHeaders = new Headers(headers);
  requestHeaders.set('Accept', 'application/json');

  // FormData carries its own multipart boundary. Setting Content-Type by hand
  // would overwrite it with one that has no boundary at all, and the upload
  // would arrive as an unparseable blob.
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
  if (body !== undefined && !isFormData) requestHeaders.set('Content-Type', 'application/json');

  const response = await fetch(url, {
    ...init,
    headers: requestHeaders,
    body: body === undefined ? undefined : isFormData ? (body as FormData) : JSON.stringify(body),
    // Same-origin only: the BFF is the only endpoint the browser knows about.
    credentials: 'same-origin',
  });

  if (response.status === 204) return { data: undefined as T };

  const payload = (await response.json().catch(() => null)) as ApiResponse<T> | null;

  if (!response.ok || !payload || payload.success === false) {
    const error = payload && payload.success === false ? payload.error : undefined;
    throw new ApiClientError(
      response.status,
      error?.code ?? 'INTERNAL_ERROR',
      error?.message ?? 'The request failed',
      error?.details,
    );
  }

  return { data: payload.data, meta: payload.meta };
}

/** Auth endpoints live outside /api/bff because they mint the session cookies. */
export async function postAuth<T>(
  path: '/login' | '/register' | '/logout',
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api/auth${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });

  const payload = (await response.json().catch(() => null)) as ApiResponse<T> | null;

  if (!response.ok || !payload || payload.success === false) {
    const error = payload && payload.success === false ? payload.error : undefined;
    throw new ApiClientError(
      response.status,
      error?.code ?? 'INTERNAL_ERROR',
      error?.message ?? 'The request failed',
      error?.details,
    );
  }

  return payload.data;
}
