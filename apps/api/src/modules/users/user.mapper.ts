import type { NodeAccessView, ProjectRole, Role, SessionUser, User } from '@dtrace/shared';
import type { PublicUserRow } from './user.select.js';

/**
 * Dates become ISO strings at the edge so the wire format matches the zod
 * schemas in @dtrace/shared exactly - the frontend never has to guess whether
 * a field is a Date or a string.
 */
export function toPublicUser(row: PublicUserRow): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role as Role,
    isActive: row.isActive,
    isChecker: row.isChecker,
    nodeAccess: row.nodeAccess.map(
      (entry): NodeAccessView => ({
        nodeId: entry.nodeId,
        nodeName: entry.node.name,
        nodeCode: entry.node.code,
        role: entry.role as ProjectRole,
        canCreateDocument: entry.canCreateDocument,
      }),
    ),
    lastLoginAt: row.lastLoginAt ? row.lastLoginAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Narrower shape returned by `GET /auth/me`. */
export function toSessionUser(row: PublicUserRow): SessionUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role as Role,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
  };
}
