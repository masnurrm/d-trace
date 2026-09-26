import { Injectable } from '@nestjs/common';
import {
  AUDIT_ACTIONS,
  DEFAULT_MATRIX,
  PERMISSIONS,
  PROJECT_ROLES,
  findMatrixViolations,
  withDefaults,
  type PermissionMatrix,
  type PermissionMatrixView,
  type ProjectRole,
  type UpdatePermissionMatrixInput,
} from '@dtrace/shared';
import { AppException } from '../../common/exceptions/app.exception.js';
import type { ClientInfo } from '../../common/decorators/client-info.decorator.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-request.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class PermissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * The stored matrix, filled out with defaults.
   *
   * Nothing is written on read: a key added in a later release simply reads as
   * its default until someone saves, which keeps deployment and configuration
   * from having to happen in the same step.
   */
  async get(): Promise<PermissionMatrixView> {
    const rows = await this.prisma.projectRolePermission.findMany({
      orderBy: { updatedAt: 'desc' },
    });

    const stored: PermissionMatrix = {};
    for (const row of rows) {
      const entry = stored[row.permission] ?? { ...DEFAULT_MATRIX[row.permission] };
      stored[row.permission] = { ...entry, [row.role]: row.allowed } as Record<
        ProjectRole,
        boolean
      >;
    }

    const latest = rows[0];

    return {
      matrix: withDefaults(stored),
      updatedAt: latest ? latest.updatedAt.toISOString() : null,
      updatedByEmail: latest?.updatedByEmail ?? null,
    };
  }

  async update(
    input: UpdatePermissionMatrixInput,
    actor: AuthenticatedUser,
    client: ClientInfo,
  ): Promise<PermissionMatrixView> {
    const current = await this.get();

    // Same guard as the settings document: an editor left open must not write
    // its stale view over someone else's save.
    if (input.expectedUpdatedAt !== undefined && current.updatedAt !== input.expectedUpdatedAt) {
      throw AppException.conflict(
        'Matriks sudah diubah di tempat lain. Muat ulang halaman lalu ulangi perubahan Anda.',
      );
    }

    const incoming = withDefaults(input.matrix);

    // Reject unknown keys outright rather than storing them: a permission the
    // application never checks is a promise the UI cannot keep.
    const known = new Set(PERMISSIONS.map((permission) => permission.key));
    const unknown = Object.keys(input.matrix).filter((key) => !known.has(key));
    if (unknown.length > 0) {
      throw AppException.validation(
        unknown.map((key) => ({ field: `matrix.${key}`, message: 'Izin tidak dikenal' })),
      );
    }

    const violations = findMatrixViolations(incoming);
    if (violations.length > 0) {
      throw AppException.validation(
        violations.map((violation) => ({
          field: `matrix.${violation.permissionKey}.${violation.role}`,
          message: violation.message,
        })),
      );
    }

    const changed = diff(current.matrix, incoming);
    if (changed.length === 0) return current;

    await this.prisma.$transaction(
      changed.map((change) =>
        this.prisma.projectRolePermission.upsert({
          where: {
            permission_role: { permission: change.permission, role: change.role as ProjectRole },
          },
          update: {
            allowed: change.to,
            updatedById: actor.id,
            updatedByEmail: actor.email,
          },
          create: {
            permission: change.permission,
            role: change.role as ProjectRole,
            allowed: change.to,
            updatedById: actor.id,
            updatedByEmail: actor.email,
          },
        }),
      ),
    );

    await this.auditService.record({
      action: AUDIT_ACTIONS.PERMISSION_MATRIX_UPDATED,
      entity: 'ProjectRolePermission',
      entityId: null,
      actorId: actor.id,
      actorEmail: actor.email,
      ip: client.ip,
      userAgent: client.userAgent,
      // The individual changes, not the whole matrix: an audit entry should
      // answer "what changed" without the reader diffing two large blobs.
      metadata: {
        changes: changed.map((change) => `${change.permission}:${change.role} ${change.from} → ${change.to}`),
        count: changed.length,
      },
    });

    return this.get();
  }

  /** Used by future enforcement points: may this project role do this? */
  async isAllowed(permission: string, role: ProjectRole): Promise<boolean> {
    const row = await this.prisma.projectRolePermission.findUnique({
      where: { permission_role: { permission, role } },
      select: { allowed: true },
    });

    return row?.allowed ?? DEFAULT_MATRIX[permission]?.[role] ?? false;
  }
}

interface MatrixChange {
  permission: string;
  role: string;
  from: boolean;
  to: boolean;
}

/** Only the cells that actually moved, so a save writes the minimum. */
function diff(before: PermissionMatrix, after: PermissionMatrix): MatrixChange[] {
  const changes: MatrixChange[] = [];

  for (const permission of PERMISSIONS) {
    for (const role of PROJECT_ROLES) {
      const from = before[permission.key]?.[role] ?? false;
      const to = after[permission.key]?.[role] ?? false;
      if (from !== to) changes.push({ permission: permission.key, role, from, to });
    }
  }

  return changes;
}
