import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ERROR_CODES, jwtPayloadSchema, type Role } from '@dtrace/shared';
import type { AppConfig } from '../../config/configuration.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { AppException } from '../exceptions/app.exception.js';
import type { AuthenticatedRequest } from '../types/authenticated-request.js';

/**
 * Registered globally in `AppModule`, so every route requires a valid access
 * token unless it is explicitly marked `@Public()`.
 *
 * Access tokens are read from the `Authorization: Bearer` header only. They are
 * intentionally *not* accepted from cookies — a cookie-borne access token would
 * be sent automatically by the browser and reintroduce CSRF on every endpoint.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractBearerToken(request.headers.authorization);
    if (!token) throw AppException.unauthorized('Missing access token');

    const jwt = this.config.get('jwt', { infer: true });

    let claims: unknown;
    try {
      claims = await this.jwtService.verifyAsync(token, {
        secret: jwt.accessSecret,
        issuer: jwt.issuer,
        audience: jwt.audience,
        algorithms: ['HS256'],
      });
    } catch (error) {
      const expired = error instanceof Error && error.name === 'TokenExpiredError';
      throw AppException.unauthorized(
        expired ? 'Access token expired' : 'Invalid access token',
        expired ? ERROR_CODES.TOKEN_EXPIRED : ERROR_CODES.TOKEN_INVALID,
      );
    }

    // Verified signature is not enough: the payload still has to be the shape
    // we expect before it becomes the request principal.
    const payload = jwtPayloadSchema.safeParse(claims);
    if (!payload.success) {
      throw AppException.unauthorized('Malformed access token', ERROR_CODES.TOKEN_INVALID);
    }

    request.user = {
      id: payload.data.sub,
      email: typeof (claims as { email?: unknown }).email === 'string'
        ? (claims as { email: string }).email
        : '',
      role: payload.data.role as Role,
      sessionId: payload.data.sid,
    };

    return true;
  }
}

function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (!scheme || !value) return null;
  return scheme.toLowerCase() === 'bearer' ? value.trim() : null;
}
