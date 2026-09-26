import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest } from '../types/authenticated-request.js';
import { getClientIp, getUserAgent } from '../utils/request.js';

export interface ClientInfo {
  ip: string | null;
  userAgent: string | null;
}

/** Request provenance for the audit trail, resolved the same way everywhere. */
export const Client = createParamDecorator((_: unknown, context: ExecutionContext): ClientInfo => {
  const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
  return { ip: getClientIp(request), userAgent: getUserAgent(request) };
});
