import { z } from 'zod';
import { AUDIT_ACTION_VALUES } from '../constants/audit.js';
import { paginationQuerySchema } from './common.schema.js';

export const auditLogSchema = z.object({
  id: z.string(),
  action: z.string(),
  entity: z.string().nullable(),
  entityId: z.string().nullable(),
  actorId: z.string().nullable(),
  actorEmail: z.string().nullable(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  /** Free-form context; the API strips known-sensitive keys before storing. */
  metadata: z.record(z.string(), z.unknown()).nullable(),
  /**
   * The changed fields as they were, and as they became. Null on the side that
   * does not exist: an insert has no `before`, a delete has no `after`.
   */
  before: z.record(z.string(), z.unknown()).nullable(),
  after: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
});

export type AuditLog = z.infer<typeof auditLogSchema>;

export const listAuditLogsQuerySchema = paginationQuerySchema.extend({
  action: z.enum(AUDIT_ACTION_VALUES).optional(),
  actorId: z.string().optional(),
  entity: z.string().max(80).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
});

export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;
