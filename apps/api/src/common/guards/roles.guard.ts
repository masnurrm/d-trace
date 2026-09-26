import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasAnyRole, hasAtLeastRole, type Role } from '@dtrace/shared';
import { MIN_ROLE_KEY, ROLES_KEY } from '../decorators/roles.decorator.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { AppException } from '../exceptions/app.exception.js';
import type { AuthenticatedRequest } from '../types/authenticated-request.js';

/**
 * Authorization layer, applied globally after `JwtAuthGuard`.
 * A route with neither `@Roles()` nor `@MinRole()` is open to any
 * authenticated user — authorization is opt-in, authentication is not.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const allowedRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, targets);
    const minRole = this.reflector.getAllAndOverride<Role>(MIN_ROLE_KEY, targets);
    if (!allowedRoles && !minRole) return true;

    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
    if (!user) throw AppException.unauthorized();

    if (allowedRoles && !hasAnyRole(user.role, allowedRoles)) throw AppException.forbidden();
    if (minRole && !hasAtLeastRole(user.role, minRole)) throw AppException.forbidden();

    return true;
  }
}
