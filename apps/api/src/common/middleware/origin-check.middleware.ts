import { Injectable, type NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import type { AppConfig } from '../../config/configuration.js';
import { AppException } from '../exceptions/app.exception.js';
import { getOrigin } from '../utils/request.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Defence in depth against CSRF on the cookie-authenticated refresh flow.
 *
 * The refresh cookie is already `SameSite=Lax` + `httpOnly`, which stops the
 * classic cross-site form post. This middleware adds the second half: any
 * state-changing request that arrives *with* an Origin/Referer must name an
 * allow-listed origin. Requests with no Origin at all (curl, server-to-server,
 * the Next.js BFF) are left alone — they are not browser-driven, so there is no
 * ambient cookie for an attacker to ride.
 */
@Injectable()
export class OriginCheckMiddleware implements NestMiddleware {
  private readonly allowed: Set<string>;

  constructor(config: ConfigService<AppConfig, true>) {
    this.allowed = new Set(config.get('corsOrigins', { infer: true }));
  }

  use(request: Request, _response: Response, next: NextFunction): void {
    if (SAFE_METHODS.has(request.method)) return next();

    const origin = getOrigin(request);
    if (!origin) return next();

    if (!this.allowed.has(origin)) {
      throw AppException.forbidden('Request origin is not allowed');
    }

    next();
  }
}
