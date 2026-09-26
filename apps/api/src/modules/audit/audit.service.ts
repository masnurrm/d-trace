import { Injectable, Logger } from '@nestjs/common';
import {
  diffRecords,
  redact,
  type AuditAction,
  type FieldValues,
  type ListAuditLogsQuery,
  type Paginated,
} from '@dtrace/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { paginate } from '../../common/utils/pagination.js';
import type { Prisma } from '../../generated/prisma/client.js';

export interface RecordAuditInput {
  action: AuditAction;
  entity?: string | null;
  entityId?: string | null;
  actorId?: string | null;
  actorEmail?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
  /**
   * The row before the change. Omit for an insert.
   * Pass the same projection as `after`, or the diff will report fields that
   * only differ because one side was not selected.
   */
  before?: FieldValues | null;
  /** The row after the change. Omit for a delete. */
  after?: FieldValues | null;
}

/**
 * Redacts a snapshot and flattens it to plain JSON.
 *
 * A row straight from Prisma holds Date and Decimal instances, which a JSON
 * column will not take. Round-tripping through JSON also drops `undefined`,
 * so an absent field and a null one stop being two different things.
 */
function toJson(value: FieldValues | null): Prisma.InputJsonValue | undefined {
  if (!value) return undefined;
  return JSON.parse(JSON.stringify(redact(value))) as Prisma.InputJsonValue;
}

const SORTABLE_FIELDS = ['createdAt', 'action', 'entity'] as const;

/**
 * Writes the trace trail that gives D-Trace its name.
 *
 * `record()` never throws: an audit write failing must not roll back the
 * business operation that succeeded, but it must be loud in the logs.
 * Metadata is redacted here rather than at each call site, so no caller can
 * accidentally persist a password or token.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(input: RecordAuditInput): Promise<void> {
    try {
      // Narrowed here rather than at each call site: a service hands over the
      // whole row and this decides what is worth keeping. An update stores only
      // the fields that moved; an insert or a delete keeps its one full side.
      const diff = diffRecords(input.before, input.after);

      await this.prisma.auditLog.create({
        data: {
          action: input.action,
          entity: input.entity ?? null,
          entityId: input.entityId ?? null,
          actorId: input.actorId ?? null,
          actorEmail: input.actorEmail ?? null,
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
          metadata: input.metadata
            ? (redact(input.metadata) as Prisma.InputJsonValue)
            : undefined,
          // Redacted like metadata: a row snapshot carries whole records, and
          // `passwordHash` is a column like any other until redact() removes it.
          before: toJson(diff.before),
          after: toJson(diff.after),
        },
      });
    } catch (error) {
      this.logger.error({ err: error, action: input.action }, 'Failed to write audit log');
    }
  }

  async list(query: ListAuditLogsQuery): Promise<Paginated<unknown>> {
    const where: Prisma.AuditLogWhereInput = {
      ...(query.action ? { action: query.action } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.entity ? { entity: query.entity } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { action: { contains: query.search, mode: 'insensitive' } },
              { actorEmail: { contains: query.search, mode: 'insensitive' } },
              { entityId: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    return paginate(this.prisma.auditLog, query, {
      where,
      allowedSortFields: SORTABLE_FIELDS,
      defaultSortField: 'createdAt',
    });
  }
}
