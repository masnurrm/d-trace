import type { Prisma } from '../../generated/prisma/client.js';

/**
 * The only projection any query of `users` should use.
 *
 * It is an allow-list, not a deny-list: adding a sensitive column to the schema
 * cannot accidentally expose it, because it will not be listed here.
 * `passwordHash`, `failedLoginAttempts` and `lockedUntil` stay server-side.
 */
export const USER_PUBLIC_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  isActive: true,
  isChecker: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  // Included so a single read answers "what can this person reach", which is
  // what both the list badge and the edit form need.
  nodeAccess: {
    select: {
      nodeId: true,
      role: true,
      canCreateDocument: true,
      node: { select: { name: true, code: true } },
    },
    orderBy: { node: { name: 'asc' } },
  },
} as const satisfies Prisma.UserSelect;

export type PublicUserRow = Prisma.UserGetPayload<{ select: typeof USER_PUBLIC_SELECT }>;
