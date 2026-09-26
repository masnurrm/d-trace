import { NextResponse, type NextRequest } from 'next/server';
import { apiBaseUrl } from '@/lib/config/env';
import { getAccessToken } from '@/lib/auth/session';

/**
 * Backend-for-frontend proxy: `/api/bff/users?page=2` -> `<API>/users?page=2`.
 *
 * Client components need live data without holding a token, so this handler
 * attaches the access token server-side and forwards the call. Deliberate
 * limits, because a proxy is exactly the thing an attacker looks for:
 *
 *  - only the methods below are forwarded;
 *  - only `/api/bff/**` paths, with traversal segments rejected outright;
 *  - only `Content-Type` is copied from the incoming request, so the caller
 *    cannot inject an `Authorization`, `Cookie` or `X-Forwarded-For` header;
 *  - the response is returned verbatim, so the API stays the single source of
 *    truth for status codes and error envelopes.
 */
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PATCH', 'PUT', 'DELETE']);

const MAX_BODY_BYTES = 1024 * 1024;
/**
 * Uploads need more room than a JSON payload, but widening the cap for every
 * route would weaken the guard everywhere to serve one path. The larger limit
 * applies only to multipart, which is what an upload actually is.
 */
const MAX_UPLOAD_BYTES = 16 * 1024 * 1024;

async function handler(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  if (!ALLOWED_METHODS.has(request.method)) {
    return errorResponse(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
  }

  const { path } = await context.params;

  // `..` or an encoded slash could otherwise walk out of the API's namespace.
  if (path.some((segment) => segment === '..' || segment.includes('/') || segment.includes('\\'))) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Invalid request path');
  }

  const accessToken = await getAccessToken();
  if (!accessToken) {
    return errorResponse(401, 'UNAUTHORIZED', 'No active session');
  }

  const search = request.nextUrl.search;
  const target = `${apiBaseUrl}/${path.map(encodeURIComponent).join('/')}${search}`;

  const headers = new Headers({
    Accept: 'application/json',
    Authorization: `Bearer ${accessToken}`,
  });

  // Pass the real client address through, so the API attributes rate limits
  // and audit records to the browser rather than to this server. It is only
  // trusted upstream when TRUST_PROXY is enabled there.
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) headers.set('X-Forwarded-For', forwardedFor);

  const contentType = request.headers.get('content-type');
  if (contentType) headers.set('Content-Type', contentType);

  // Read as bytes, not text: a file upload decoded as UTF-8 and re-encoded
  // arrives corrupted, and the corruption is silent.
  let body: ArrayBuffer | undefined;
  if (request.method !== 'GET') {
    body = await request.arrayBuffer();
    const limit = contentType?.startsWith('multipart/form-data') ? MAX_UPLOAD_BYTES : MAX_BODY_BYTES;
    if (body.byteLength > limit) {
      return errorResponse(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
    }
  }

  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body,
    cache: 'no-store',
  });

  if (upstream.status === 204) {
    return new NextResponse(null, { status: 204 });
  }

  // Downloads come back as bytes too, so the response is passed through
  // unchanged rather than round-tripped through a string.
  const payload = await upstream.arrayBuffer();

  const responseHeaders = new Headers({
    'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
    // Responses here are per-user; never let a shared cache keep them.
    'Cache-Control': 'no-store',
  });

  // The only upstream headers worth forwarding: the filename a download
  // should be saved as, and the two that keep an inline-rendered PDF from
  // being treated as anything else. Dropping the latter here would quietly
  // undo the hardening the API applied.
  for (const header of [
    'content-disposition',
    'x-content-type-options',
    'content-security-policy',
  ]) {
    const value = upstream.headers.get(header);
    if (value) responseHeaders.set(header, value);
  }

  return new NextResponse(payload, { status: upstream.status, headers: responseHeaders });
}

function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json(
    {
      success: false,
      error: { code, message },
      requestId: '',
      timestamp: new Date().toISOString(),
    },
    { status },
  );
}

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const PUT = handler;
export const DELETE = handler;
