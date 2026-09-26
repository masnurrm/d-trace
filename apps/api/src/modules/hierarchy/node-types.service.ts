import { Injectable } from '@nestjs/common';
import {
  AUDIT_ACTIONS,
  type CreateNodeTypeInput,
  type NodeTypeView,
  type UpdateNodeTypeInput,
} from '@dtrace/shared';
import { AppException } from '../../common/exceptions/app.exception.js';
import type { ClientInfo } from '../../common/decorators/client-info.decorator.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-request.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';

const TYPE_INCLUDE = {
  allowedParents: { select: { id: true, name: true, code: true } },
  _count: { select: { nodes: true } },
} satisfies Prisma.NodeTypeInclude;

type NodeTypeRow = Prisma.NodeTypeGetPayload<{ include: typeof TYPE_INCLUDE }>;

/**
 * Node types are the grammar of the hierarchy: they decide what may be placed
 * where. Everything here guards that grammar stays usable — a type nobody can
 * place, or a rule that contradicts existing data, is rejected at the door.
 */
@Injectable()
export class NodeTypesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async list(includeInactive: boolean): Promise<NodeTypeView[]> {
    const rows = await this.prisma.nodeType.findMany({
      where: includeInactive ? {} : { isActive: true },
      include: TYPE_INCLUDE,
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });

    return rows.map(toView);
  }

  async create(
    input: CreateNodeTypeInput,
    actor: AuthenticatedUser,
    client: ClientInfo,
  ): Promise<NodeTypeView> {
    await this.assertCodeIsFree(input.code);
    await this.assertParentsExist(input.allowedParentIds);

    const position = await this.prisma.nodeType.count();

    const row = await this.prisma.nodeType.create({
      data: {
        name: input.name,
        code: input.code,
        canBeRoot: input.canBeRoot,
        isActive: input.isActive,
        position,
        allowedParents: { connect: input.allowedParentIds.map((id) => ({ id })) },
      },
      include: TYPE_INCLUDE,
    });

    await this.auditService.record({
      action: AUDIT_ACTIONS.NODE_TYPE_CREATED,
      entity: 'NodeType',
      entityId: row.id,
      actorId: actor.id,
      actorEmail: actor.email,
      ip: client.ip,
      userAgent: client.userAgent,
      after: row,
    });

    return toView(row);
  }

  async update(
    id: string,
    input: UpdateNodeTypeInput,
    actor: AuthenticatedUser,
    client: ClientInfo,
  ): Promise<NodeTypeView> {
    const current = await this.requireType(id);

    if (input.code !== current.code) await this.assertCodeIsFree(input.code);
    await this.assertParentsExist(input.allowedParentIds);

    // A type cannot be its own parent: that would let a branch nest forever.
    if (input.allowedParentIds.includes(id)) {
      const allowsItself = await this.prisma.node.findFirst({
        where: { typeId: id, parent: { typeId: id } },
        select: { id: true },
      });
      if (!allowsItself) {
        // Self-nesting is legitimate for some shapes (a Department under a
        // Department), so it is allowed - but only knowingly, never by accident
        // of a bulk edit that also turns off every other parent.
        if (input.allowedParentIds.length === 1 && !input.canBeRoot) {
          throw AppException.conflict(
            'Jenis ini hanya boleh berada di bawah dirinya sendiri, sehingga tidak akan pernah bisa dibuat. Tambahkan induk lain atau izinkan sebagai akar.',
          );
        }
      }
    }

    // Changing the rules must not orphan what is already placed.
    await this.assertRulesFitExistingNodes(id, input);

    const row = await this.prisma.nodeType.update({
      where: { id },
      data: {
        name: input.name,
        code: input.code,
        canBeRoot: input.canBeRoot,
        isActive: input.isActive,
        allowedParents: { set: input.allowedParentIds.map((parentId) => ({ id: parentId })) },
      },
      include: TYPE_INCLUDE,
    });

    await this.auditService.record({
      action: AUDIT_ACTIONS.NODE_TYPE_UPDATED,
      entity: 'NodeType',
      entityId: id,
      actorId: actor.id,
      actorEmail: actor.email,
      ip: client.ip,
      userAgent: client.userAgent,
      before: current,
      after: row,
    });

    return toView(row);
  }

  async remove(id: string, actor: AuthenticatedUser, client: ClientInfo): Promise<void> {
    const current = await this.requireType(id);

    if (current._count.nodes > 0) {
      throw AppException.conflict(
        `Jenis ini masih dipakai oleh ${current._count.nodes} node. Pindahkan node tersebut ke jenis lain, atau nonaktifkan jenis ini.`,
      );
    }

    const usedAsParent = await this.prisma.nodeType.count({
      where: { allowedParents: { some: { id } } },
    });
    if (usedAsParent > 0) {
      throw AppException.conflict(
        `Jenis ini masih menjadi induk yang diizinkan bagi ${usedAsParent} jenis lain. Lepaskan dulu dari aturan penempatan mereka.`,
      );
    }

    await this.prisma.nodeType.delete({ where: { id } });

    await this.auditService.record({
      action: AUDIT_ACTIONS.NODE_TYPE_DELETED,
      entity: 'NodeType',
      entityId: id,
      actorId: actor.id,
      actorEmail: actor.email,
      ip: client.ip,
      userAgent: client.userAgent,
      before: current,
    });
  }

  private async requireType(id: string): Promise<NodeTypeRow> {
    const row = await this.prisma.nodeType.findUnique({ where: { id }, include: TYPE_INCLUDE });
    if (!row) throw AppException.notFound('Jenis node');
    return row;
  }

  private async assertCodeIsFree(code: string): Promise<void> {
    const clash = await this.prisma.nodeType.findUnique({ where: { code }, select: { id: true } });
    if (clash) throw AppException.conflict(`Kode ${code} sudah dipakai jenis lain`);
  }

  private async assertParentsExist(ids: string[]): Promise<void> {
    if (ids.length === 0) return;

    const found = await this.prisma.nodeType.count({ where: { id: { in: ids } } });
    if (found !== new Set(ids).size) {
      throw AppException.validation([
        { field: 'allowedParentIds', message: 'Ada jenis induk yang tidak ditemukan' },
      ]);
    }
  }

  /**
   * Refuses a rule change that would invalidate placements already in the tree.
   *
   * Without this, turning off "boleh di bawah Department" would leave existing
   * nodes sitting somewhere the rules now forbid — valid data that no longer
   * satisfies its own schema, which is the hardest kind of mess to unpick later.
   */
  private async assertRulesFitExistingNodes(
    typeId: string,
    input: UpdateNodeTypeInput,
  ): Promise<void> {
    const placed = await this.prisma.node.findMany({
      where: { typeId },
      select: { id: true, name: true, parentId: true, parent: { select: { typeId: true } } },
    });

    if (placed.length === 0) return;

    const allowed = new Set(input.allowedParentIds);

    for (const node of placed) {
      if (node.parentId === null) {
        if (!input.canBeRoot) {
          throw AppException.conflict(
            `Node "${node.name}" berada di akar. Matikan "boleh jadi akar" hanya setelah node tersebut dipindahkan.`,
          );
        }
        continue;
      }

      const parentTypeId = node.parent?.typeId;
      if (parentTypeId && !allowed.has(parentTypeId)) {
        throw AppException.conflict(
          `Node "${node.name}" sudah berada di bawah jenis yang akan Anda hapus dari daftar induk. Pindahkan node tersebut dulu.`,
        );
      }
    }
  }
}

function toView(row: NodeTypeRow): NodeTypeView {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    canBeRoot: row.canBeRoot,
    isActive: row.isActive,
    allowedParents: row.allowedParents,
    nodeCount: row._count.nodes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
