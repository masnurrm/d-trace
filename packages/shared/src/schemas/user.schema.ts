import { z } from 'zod';
import { ROLES, ROLE_VALUES } from '../constants/roles.js';
import { emailSchema, passwordSchema } from './auth.schema.js';
import { paginationQuerySchema } from './common.schema.js';
import { PROJECT_ROLES } from './permission.schema.js';

/**
 * One node a user may reach, and what they are there.
 *
 * Access is granted per node rather than per project: a node already carries
 * the org structure, so "this person, at IAMI, is a Collaborator" is the whole
 * statement. `canCreateDocument` is the one extra a Manager may hand a
 * Collaborator, bounded by the Role & Akses matrix.
 */
export const nodeAccessEntrySchema = z.object({
  nodeId: z.uuid(),
  role: z.enum(PROJECT_ROLES),
  canCreateDocument: z.boolean().default(false),
});

export type NodeAccessEntryInput = z.infer<typeof nodeAccessEntrySchema>;

export interface NodeAccessView {
  nodeId: string;
  nodeName: string;
  nodeCode: string;
  role: (typeof PROJECT_ROLES)[number];
  canCreateDocument: boolean;
}

export const userSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  role: z.enum(ROLE_VALUES),
  isActive: z.boolean(),
  /** Only a Checker may create a Form Checklist or record a CCB Go/NoGo. */
  isChecker: z.boolean().default(false),
  /** Every node this person can reach, and what they are there. */
  nodeAccess: z.array(z.object({
    nodeId: z.string(),
    nodeName: z.string(),
    nodeCode: z.string(),
    role: z.enum(PROJECT_ROLES),
    canCreateDocument: z.boolean(),
  })).default([]),
  lastLoginAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type User = z.infer<typeof userSchema>;

export const createUserSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: emailSchema,
  password: passwordSchema,
  /**
   * The system role is no longer chosen on the user form: every account is
   * created as an ordinary user, and the working role now lives per node.
   * Super Admin comes from the seed, deliberately.
   */
  role: z.enum(ROLE_VALUES).default(ROLES.VIEWER),
  isChecker: z.boolean().default(false),
  nodeAccess: z.array(nodeAccessEntrySchema).max(500).default([]),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;

/**
 * Deliberately omits `password` and `role`: privilege changes go through the
 * dedicated role endpoint so they can be audited separately.
 */
export const updateUserSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    email: emailSchema.optional(),
    isActive: z.boolean().optional(),
    isChecker: z.boolean().optional(),
    /** Sent whole: the list the form shows replaces what is stored. */
    nodeAccess: z.array(nodeAccessEntrySchema).max(500).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const updateUserRoleSchema = z.object({
  role: z.enum(ROLE_VALUES),
});

export type UpdateUserRoleInput = z.infer<typeof updateUserRoleSchema>;

export const listUsersQuerySchema = paginationQuerySchema.extend({
  role: z.enum(ROLE_VALUES).optional(),
  isActive: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => (typeof value === 'boolean' ? value : value === 'true'))
    .optional(),
});

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
