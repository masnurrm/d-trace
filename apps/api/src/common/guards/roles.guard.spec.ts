import { beforeEach, describe, expect, it } from 'vitest';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { ROLES } from '@dtrace/shared';
import { MIN_ROLE_KEY, ROLES_KEY } from '../decorators/roles.decorator.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { RolesGuard } from './roles.guard.js';
import type { AuthenticatedUser } from '../types/authenticated-request.js';

/** Minimal ExecutionContext double; the guard only reads `request.user`. */
function contextFor(user?: AuthenticatedUser): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

function principal(role: AuthenticatedUser['role']): AuthenticatedUser {
  return { id: 'user-1', email: 'user@dtrace.local', role, sessionId: 'session-1' };
}

describe('RolesGuard', () => {
  let reflector: Reflector;
  let guard: RolesGuard;
  let metadata: Record<string, unknown>;

  beforeEach(() => {
    metadata = {};
    reflector = {
      getAllAndOverride: (key: string) => metadata[key],
    } as unknown as Reflector;
    guard = new RolesGuard(reflector);
  });

  it('allows a route with no role metadata to any authenticated user', () => {
    expect(guard.canActivate(contextFor(principal(ROLES.VIEWER)))).toBe(true);
  });

  it('lets public routes through without a principal', () => {
    metadata[IS_PUBLIC_KEY] = true;
    expect(guard.canActivate(contextFor(undefined))).toBe(true);
  });

  it('enforces an explicit role list', () => {
    metadata[ROLES_KEY] = [ROLES.ADMIN];

    expect(guard.canActivate(contextFor(principal(ROLES.ADMIN)))).toBe(true);
    expect(() => guard.canActivate(contextFor(principal(ROLES.AUDITOR)))).toThrow();
  });

  it('treats @MinRole as "this rank or above"', () => {
    metadata[MIN_ROLE_KEY] = ROLES.AUDITOR;

    expect(guard.canActivate(contextFor(principal(ROLES.ADMIN)))).toBe(true);
    expect(guard.canActivate(contextFor(principal(ROLES.AUDITOR)))).toBe(true);
    expect(() => guard.canActivate(contextFor(principal(ROLES.OPERATOR)))).toThrow();
    expect(() => guard.canActivate(contextFor(principal(ROLES.VIEWER)))).toThrow();
  });

  it('refuses a protected route when no principal was attached', () => {
    metadata[ROLES_KEY] = [ROLES.ADMIN];
    expect(() => guard.canActivate(contextFor(undefined))).toThrow();
  });
});
