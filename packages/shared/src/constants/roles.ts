/**
 * Single source of truth for authorization. The API enforces these values and
 * the web app reads them to decide what to render — never redefine them locally.
 */
export const ROLES = {
  /**
   * The platform operator. The only role that may open the Admin Panel, and
   * the only one that may grant this role to someone else.
   *
   * ADMIN below it is *not* a lesser version of this: it is the role a person
   * carries into a workspace. Someone can administer their own work without
   * being trusted with the configuration of the platform itself.
   */
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  AUDITOR: 'AUDITOR',
  OPERATOR: 'OPERATOR',
  VIEWER: 'VIEWER',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

/** Readonly tuple (not `Object.values`) so `z.enum(ROLE_VALUES)` keeps literal types. */
export const ROLE_VALUES = [
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
  ROLES.AUDITOR,
  ROLES.OPERATOR,
  ROLES.VIEWER,
] as const;

/** What each role is called on screen. Codes stay in the data, never in copy. */
export const ROLE_LABELS: Record<Role, string> = {
  [ROLES.SUPER_ADMIN]: 'Super Admin',
  [ROLES.ADMIN]: 'Admin',
  [ROLES.AUDITOR]: 'Auditor',
  [ROLES.OPERATOR]: 'Operator',
  [ROLES.VIEWER]: 'Viewer',
};

/**
 * Higher number == more privilege. Used by `hasAtLeastRole` so route guards can
 * express "OPERATOR or above" instead of enumerating every role.
 */
export const ROLE_RANK: Record<Role, number> = {
  [ROLES.VIEWER]: 0,
  [ROLES.OPERATOR]: 10,
  [ROLES.AUDITOR]: 20,
  [ROLES.ADMIN]: 30,
  [ROLES.SUPER_ADMIN]: 40,
};

export function hasAtLeastRole(actual: Role, required: Role): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

export function hasAnyRole(actual: Role, allowed: readonly Role[]): boolean {
  return allowed.includes(actual);
}

/**
 * The two halves of the application.
 *
 * `workspace` is where work happens — projects and documents. `admin` is where
 * the platform itself is configured: accounts, hierarchy, templates, the audit
 * trail. Which half a route belongs to is a property of the route, and who may
 * enter each half is decided here rather than in the sidebar, so the navigation
 * and the route guards can never disagree about it.
 */
export const APP_MODES = ['workspace', 'admin'] as const;
export type AppMode = (typeof APP_MODES)[number];

/** Only the platform operator may open the Admin Panel. */
export function canOpenAdminPanel(role: Role): boolean {
  return role === ROLES.SUPER_ADMIN;
}

/** Where a session lands after signing in, and what `/` forwards to. */
export function defaultModeFor(role: Role): AppMode {
  return canOpenAdminPanel(role) ? 'admin' : 'workspace';
}
