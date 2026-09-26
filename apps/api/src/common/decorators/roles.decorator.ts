import { SetMetadata } from '@nestjs/common';
import type { Role } from '@dtrace/shared';

export const ROLES_KEY = 'dtrace:roles';

/** Restrict a route to an explicit set of roles, enforced by `RolesGuard`. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const MIN_ROLE_KEY = 'dtrace:minRole';

/** Restrict a route to a role *and everything above it* in ROLE_RANK. */
export const MinRole = (role: Role) => SetMetadata(MIN_ROLE_KEY, role);
