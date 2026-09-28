import { NextResponse, type NextRequest } from 'next/server';
import { refreshSession } from './lib/auth/refresh';
import { ACCESS_COOKIE, REFRESH_COOKIE, accessCookieMaxAge } from './lib/auth/session';
import { socketUrl } from './lib/config/env';

/**
 * Middleware does three jobs, in this order:
 *
 *  1. keeps the session alive - if the access cookie has expired but a refresh
 *     cookie remains, it silently rotates before the page renders;
 *  2. gates routes - unauthenticated users never reach an app page, and signed
 *     in users are bounced off the login screen;
 *  3. sets the Content-Security-Policy with a per-request nonce.
 *
 * Route gating here is for *user experience*, not security: the API is the
 * authority and re-checks every request. Middleware only decides what to render.
 */
const PUBLIC_PATHS = ['/login', '/register', '/undangan'];

/**
 * Paths a signed-in visitor may still open.
 *
 * `/login` bounces somebody who already has a session — there is nothing there
 * for them. An invitation link is different: it is a one-time credential that
 * may well be opened in a browser already signed in as somebody else, and
 * bouncing it would strand the invitation with no way to reach it.
 */
const PUBLIC_PATHS_FOR_SIGNED_IN = ['/undangan'];

function matches(paths: string[], pathname: string): boolean {
  return paths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function isPublicPath(pathname: string): boolean {
  return matches(PUBLIC_PATHS, pathname);
}

/**
 * The one origin the browser may open a connection to besides this app: the
 * notification socket. Both schemes are listed because Socket.IO polls over
 * http(s) before it upgrades, and a connect-src that allowed only ws: would
 * block the handshake that precedes the upgrade.
 */
const socketOrigins = (() => {
  try {
    const url = new URL(socketUrl);
    const ws = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${url.origin} ${ws}//${url.host}`;
  } catch {
    return '';
  }
})();

function buildCsp(nonce: string, isDevelopment: boolean): string {
  return [
    "default-src 'self'",
    // `strict-dynamic` lets the nonced Next bootstrap load its own chunks
    // without whitelisting whole origins. 'unsafe-eval' is dev-only (HMR).
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${isDevelopment ? "'unsafe-eval'" : ''}`,
    // Tailwind injects styles at runtime, so styles cannot be nonce-only.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    // The browser calls this app, plus the notification socket — and nothing
    // else. The API's HTTP surface is still reached server-side only.
    `connect-src 'self' ${socketOrigins}${isDevelopment ? ' ws: http://localhost:*' : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // 'self', not 'none': a cross-origin frame is still refused, which is the
    // clickjacking case. The document page frames its own PDF preview.
    "frame-ancestors 'self'",
    ...(isDevelopment ? [] : ['upgrade-insecure-requests']),
  ]
    .filter(Boolean)
    .join('; ');
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;
  const isDevelopment = process.env.NODE_ENV !== 'production';

  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', buildCsp(nonce, isDevelopment));

  const accessToken = request.cookies.get(ACCESS_COOKIE)?.value;
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;

  let response: NextResponse | null = null;
  let hasSession = Boolean(accessToken);
  let rotated: Awaited<ReturnType<typeof refreshSession>> = null;

  if (!accessToken && refreshToken) {
    rotated = await refreshSession(refreshToken, request.headers.get('x-forwarded-for'));
    hasSession = rotated !== null;
  }

  // A fetch() call must get a JSON 401 from the route handler, not a 307 to an
  // HTML page it cannot parse. Only page navigations are redirected.
  const isDataRoute = pathname.startsWith('/api/');

  if (!hasSession && !isDataRoute && !isPublicPath(pathname)) {
    const loginUrl = new URL('/login', request.url);
    // Round-trip the destination so the user lands where they were going.
    if (pathname !== '/') loginUrl.searchParams.set('next', `${pathname}${search}`);
    response = NextResponse.redirect(loginUrl);
    response.cookies.delete(ACCESS_COOKIE);
    response.cookies.delete(REFRESH_COOKIE);
  } else if (
    hasSession &&
    isPublicPath(pathname) &&
    !matches(PUBLIC_PATHS_FOR_SIGNED_IN, pathname)
  ) {
    // The root decides which half this account lands in; it is the only place
    // that knows the role, and duplicating that rule here would let the two
    // drift apart.
    response = NextResponse.redirect(new URL('/', request.url));
  } else {
    response = NextResponse.next({ request: { headers: requestHeaders } });
  }

  if (rotated) {
    const cookieOptions = {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: !isDevelopment,
      path: '/',
    };
    response.cookies.set(ACCESS_COOKIE, rotated.accessToken, {
      ...cookieOptions,
      maxAge: accessCookieMaxAge(rotated.expiresIn),
    });
    if (rotated.refreshToken) {
      response.cookies.set(REFRESH_COOKIE, rotated.refreshToken, {
        ...cookieOptions,
        maxAge: 60 * 60 * 24 * 7,
      });
    }
  }

  response.headers.set('content-security-policy', buildCsp(nonce, isDevelopment));
  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except Next internals and static files. The BFF routes under
     * /api are included on purpose: an expired access cookie should be
     * refreshed for a data fetch just as it is for a page view.
     */
    {
      source:
        '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|doc|docx|xls|xlsx|ppt|pptx|zip)$).*)',
      missing: [{ type: 'header', key: 'next-action' }],
    },
  ],
};
