import type { Request } from 'express';
import type { JwtPayload, Role } from '@dtrace/shared';

/** The principal attached by `JwtAuthGuard`. Never trust anything else. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  role: Role;
  sessionId: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

/**
 * `request.id` is contributed by pino-http and typed as `ReqId` (string |
 * number | object). Normalise it in one place rather than casting at every
 * call site.
 */
export function getRequestId(request: Request): string {
  const id = (request as Request & { id?: unknown }).id;
  return typeof id === 'string' ? id : typeof id === 'number' ? String(id) : '';
}

export type { JwtPayload };
