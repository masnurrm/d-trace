import type { Request } from 'express';

/**
 * `request.ip` already honours `trust proxy`, which we only enable when the
 * TRUST_PROXY env var says the deployment sits behind a proxy we control.
 * Reading `x-forwarded-for` unconditionally would let any client spoof its IP.
 */
export function getClientIp(request: Request): string | null {
  return request.ip ?? request.socket?.remoteAddress ?? null;
}

export function getUserAgent(request: Request): string | null {
  const agent = request.headers['user-agent'];
  return typeof agent === 'string' ? agent.slice(0, 512) : null;
}

export function getOrigin(request: Request): string | null {
  const origin = request.headers.origin;
  if (typeof origin === 'string') return origin;

  const referer = request.headers.referer;
  if (typeof referer !== 'string') return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}
