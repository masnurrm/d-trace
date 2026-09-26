import { Injectable } from '@nestjs/common';
import {
  AUDIT_ACTIONS,
  type CreateNodeInput,
  type ListNodesQuery,
  type MoveNodeInput,
  type NodeView,
  type SetNodeActivationInput,
  type UpdateNodeInput,
} from '@dtrace/shared';
import { AppException } from '../../common/exceptions/app.exception.js';
import type { ClientInfo } from '../../common/decorators/client-info.decorator.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-request.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';

const NODE_INCLUDE = {
  type: { select: { id: true, name: true, code: true } },
  _count: { select: { children: true } },
} satisfies Prisma.NodeInclude;

type NodeRow = Prisma.NodeGetPayload<{ include: typeof NODE_INCLUDE }>;

/** Minimal shape for the in-memory tree walks below. */
interface Edge {
  id: string;
  parentId: string | null;
  depth: number;
  isActive: boolean;
  name: string;
}

@Injectable()
export class NodesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * The whole hierarchy in one flat array.
   *
   * Sending everything is deliberate: an organisation chart is hundreds of rows
   * at most, and one payload makes expanding, searching and re-parenting
   * instant in the browser instead of a round trip each. If a deployment ever
   * outgrows that, this is the single place to add paging.
   */
  async list(query: ListNodesQuery): Promise<NodeView[]> {
    const where: Prisma.NodeWhereInput = {
      ...(query.includeInactive ? {} : { isActive: true }),
      ...(query.typeId ? { typeId: query.typeId } : {}),
      ...(query.depth !== undefined ? { depth: query.depth } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { code: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const rows = await this.prisma.node.findMany({
      where,
      include: NODE_INCLUDE,
      orderBy: [{ depth: 'asc' }, { position: 'asc' }, { name: 'asc' }],
    });

    return rows.map(toView);
  }

  async create(
    input: CreateNodeInput,
    actor: AuthenticatedUser,
    client: ClientInfo,
  ): Promise<NodeView> {
    await this.assertCodeIsFree(input.code);

    const parent = input.parentId ? await this.requireNode(input.parentId) : null;
    await this.assertPlacementAllowed(input.typeId, parent?.typeId ?? null);

    if (parent && !parent.isActive) {
      throw AppException.conflict(
        `Induk "${parent.name}" sedang nonaktif. Aktifkan dulu sebelum menambah anak di bawahnya.`,
      );
    }

    const position = await this.prisma.node.count({ where: { parentId: input.parentId } });

    const row = await this.prisma.node.create({
      data: {
        name: input.name,
        code: input.code,
        typeId: input.typeId,
        parentId: input.parentId,
        depth: parent ? parent.depth + 1 : 0,
        position,
      },
      include: NODE_INCLUDE,
    });

    await this.auditService.record({
      action: AUDIT_ACTIONS.NODE_CREATED,
      entity: 'Node',
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
    input: UpdateNodeInput,
    actor: AuthenticatedUser,
    client: ClientInfo,
  ): Promise<NodeView> {
    const current = await this.requireNode(id);

    if (input.code && input.code !== current.code) await this.assertCodeIsFree(input.code);

    if (input.typeId && input.typeId !== current.typeId) {
      // The new type has to allow where this node already stands, and to allow
      // every child that already hangs beneath it.
      const parent = current.parentId ? await this.requireNode(current.parentId) : null;
      await this.assertPlacementAllowed(input.typeId, parent?.typeId ?? null);
      await this.assertChildrenStillFit(id, input.typeId);
    }

    const row = await this.prisma.node.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.typeId !== undefined ? { typeId: input.typeId } : {}),
      },
      include: NODE_INCLUDE,
    });

    await this.auditService.record({
      action: AUDIT_ACTIONS.NODE_UPDATED,
      entity: 'Node',
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

  /**
   * Re-parents a node and the branch under it.
   *
   * Three things must hold: the target is not inside the node's own subtree
   * (which would detach the branch from the tree entirely), the type rules
   * allow the new placement, and every descendant's depth is corrected.
   */
  async move(
    id: string,
    input: MoveNodeInput,
    actor: AuthenticatedUser,
    client: ClientInfo,
  ): Promise<NodeView> {
    const current = await this.requireNode(id);
    if (current.parentId === input.parentId) return toView(current);

    if (input.parentId === id) {
      throw AppException.conflict('Sebuah node tidak bisa menjadi induk dirinya sendiri.');
    }

    const edges = await this.loadEdges();
    const descendants = new Set(collectDescendants(edges, id));

    if (input.parentId && descendants.has(input.parentId)) {
      throw AppException.conflict(
        'Tujuan berada di dalam cabang node ini. Memindahkannya ke sana akan memutus cabang dari hierarki.',
      );
    }

    const parent = input.parentId ? await this.requireNode(input.parentId) : null;
    await this.assertPlacementAllowed(current.typeId, parent?.typeId ?? null);

    if (parent && !parent.isActive && current.isActive) {
      throw AppException.conflict(
        `Tujuan "${parent.name}" sedang nonaktif. Node aktif tidak boleh berada di bawah induk nonaktif.`,
      );
    }

    const newDepth = parent ? parent.depth + 1 : 0;
    const shift = newDepth - current.depth;
    const position = await this.prisma.node.count({ where: { parentId: input.parentId } });

    await this.prisma.$transaction(async (tx) => {
      await tx.node.update({
        where: { id },
        data: { parentId: input.parentId, depth: newDepth, position },
      });

      // Depth is denormalised, so the whole branch shifts with its root.
      if (shift !== 0 && descendants.size > 0) {
        for (const descendantId of descendants) {
          const edge = edges.find((candidate) => candidate.id === descendantId);
          if (!edge) continue;
          await tx.node.update({
            where: { id: descendantId },
            data: { depth: edge.depth + shift },
          });
        }
      }
    });

    const row = await this.requireNode(id);

    await this.auditService.record({
      action: AUDIT_ACTIONS.NODE_MOVED,
      // The snapshot shows parentId and depth moving; the metadata below keeps
      // the requested move itself, which a diff of the row cannot express.
      before: current,
      after: row,
      entity: 'Node',
      entityId: id,
      actorId: actor.id,
      actorEmail: actor.email,
      ip: client.ip,
      userAgent: client.userAgent,
      metadata: {
        from: current.parentId,
        to: input.parentId,
        movedWithDescendants: descendants.size,
      },
    });

    return toView(row);
  }

  /**
   * Activation, applied to whole branches.
   *
   * Deactivating sweeps downwards: a live node under a dead parent is a
   * contradiction the UI would have to explain away. Activating deliberately
   * does *not* sweep upwards — it refuses instead, because silently reviving
   * ancestors is a bigger change than the operator asked for.
   */
  async setActivation(
    input: SetNodeActivationInput,
    actor: AuthenticatedUser,
    client: ClientInfo,
  ): Promise<{ affected: number }> {
    const edges = await this.loadEdges();
    const byId = new Map(edges.map((edge) => [edge.id, edge]));

    for (const id of input.ids) {
      if (!byId.has(id)) throw AppException.notFound('Node');
    }

    const targets = new Set<string>();

    for (const id of input.ids) {
      targets.add(id);

      if (!input.isActive) {
        for (const descendant of collectDescendants(edges, id)) targets.add(descendant);
        continue;
      }

      let parentId = byId.get(id)?.parentId ?? null;
      while (parentId) {
        const parent = byId.get(parentId);
        if (!parent) break;
        if (!parent.isActive && !input.ids.includes(parent.id)) {
          throw AppException.conflict(
            `Node "${byId.get(id)?.name}" berada di bawah "${parent.name}" yang nonaktif. Aktifkan induknya dulu, atau centang keduanya sekaligus.`,
          );
        }
        parentId = parent.parentId;
      }
    }

    const result = await this.prisma.node.updateMany({
      where: { id: { in: [...targets] } },
      data: { isActive: input.isActive },
    });

    await this.auditService.record({
      action: AUDIT_ACTIONS.NODE_ACTIVATION_CHANGED,
      entity: 'Node',
      entityId: input.ids[0] ?? null,
      actorId: actor.id,
      actorEmail: actor.email,
      ip: client.ip,
      userAgent: client.userAgent,
      metadata: {
        isActive: input.isActive,
        requested: input.ids.length,
        affected: result.count,
      },
    });

    return { affected: result.count };
  }

  async remove(id: string, actor: AuthenticatedUser, client: ClientInfo): Promise<void> {
    const current = await this.requireNode(id);

    if (current._count.children > 0) {
      throw AppException.conflict(
        `Node ini masih punya ${current._count.children} anak. Pindahkan atau hapus anaknya lebih dulu.`,
      );
    }

    await this.prisma.node.delete({ where: { id } });

    await this.auditService.record({
      action: AUDIT_ACTIONS.NODE_DELETED,
      entity: 'Node',
      entityId: id,
      actorId: actor.id,
      actorEmail: actor.email,
      ip: client.ip,
      userAgent: client.userAgent,
      before: current,
    });
  }

  private async requireNode(id: string): Promise<NodeRow> {
    const row = await this.prisma.node.findUnique({ where: { id }, include: NODE_INCLUDE });
    if (!row) throw AppException.notFound('Node');
    return row;
  }

  private async loadEdges(): Promise<Edge[]> {
    return this.prisma.node.findMany({
      select: { id: true, parentId: true, depth: true, isActive: true, name: true },
    });
  }

  private async assertCodeIsFree(code: string): Promise<void> {
    const clash = await this.prisma.node.findUnique({ where: { code }, select: { id: true } });
    if (clash) throw AppException.conflict(`Kode ${code} sudah dipakai node lain`);
  }

  /** The heart of the grammar: may a node of `typeId` sit under `parentTypeId`? */
  private async assertPlacementAllowed(
    typeId: string,
    parentTypeId: string | null,
  ): Promise<void> {
    const type = await this.prisma.nodeType.findUnique({
      where: { id: typeId },
      include: { allowedParents: { select: { id: true, name: true } } },
    });
    if (!type) throw AppException.notFound('Jenis node');

    if (!type.isActive) {
      throw AppException.conflict(`Jenis "${type.name}" sedang nonaktif dan tidak bisa dipakai.`);
    }

    if (parentTypeId === null) {
      if (!type.canBeRoot) {
        throw AppException.conflict(
          `Jenis "${type.name}" tidak boleh berdiri di akar. Letakkan di bawah node lain.`,
        );
      }
      return;
    }

    if (!type.allowedParents.some((parent) => parent.id === parentTypeId)) {
      const parentType = await this.prisma.nodeType.findUnique({
        where: { id: parentTypeId },
        select: { name: true },
      });
      const allowed = type.allowedParents.map((parent) => parent.name).join(', ') || '—';
      throw AppException.conflict(
        `Jenis "${type.name}" tidak boleh berada di bawah "${parentType?.name ?? 'jenis itu'}". Yang diizinkan: ${allowed}.`,
      );
    }
  }

  /** After a type change, the node's existing children must still be legal. */
  private async assertChildrenStillFit(nodeId: string, newTypeId: string): Promise<void> {
    const children = await this.prisma.node.findMany({
      where: { parentId: nodeId },
      select: { name: true, type: { select: { id: true, name: true, allowedParents: { select: { id: true } } } } },
    });

    for (const child of children) {
      const allowed = child.type.allowedParents.some((parent) => parent.id === newTypeId);
      if (!allowed) {
        throw AppException.conflict(
          `Anak "${child.name}" berjenis ${child.type.name}, yang tidak boleh berada di bawah jenis baru ini.`,
        );
      }
    }
  }
}

/** Breadth-first walk over the flat edge list; no recursion, no SQL recursion. */
function collectDescendants(edges: Edge[], rootId: string): string[] {
  const childrenByParent = new Map<string, string[]>();
  for (const edge of edges) {
    if (!edge.parentId) continue;
    const siblings = childrenByParent.get(edge.parentId) ?? [];
    siblings.push(edge.id);
    childrenByParent.set(edge.parentId, siblings);
  }

  const result: string[] = [];
  const queue = [...(childrenByParent.get(rootId) ?? [])];
  while (queue.length > 0) {
    const current = queue.shift()!;
    result.push(current);
    queue.push(...(childrenByParent.get(current) ?? []));
  }
  return result;
}

function toView(row: NodeRow): NodeView {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    parentId: row.parentId,
    depth: row.depth,
    position: row.position,
    isActive: row.isActive,
    type: row.type,
    childCount: row._count.children,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
