import { Injectable } from '@nestjs/common';
import {
  AUDIT_ACTIONS,
  ROLES,
  hasAtLeastRole,
  type CreateUserInput,
  type ListUsersQuery,
  type PaginationMeta,
  type Role,
  type UpdateUserInput,
  type NodeAccessEntryInput,
  type ProjectRole,
  type User,
} from '@dtrace/shared';
import { AppException } from '../../common/exceptions/app.exception.js';
import type { ClientInfo } from '../../common/decorators/client-info.decorator.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-request.js';
import { paginate } from '../../common/utils/pagination.js';
import { AuditService } from '../audit/audit.service.js';
import { PasswordService } from '../auth/password.service.js';
import { TokenService } from '../auth/token.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { USER_PUBLIC_SELECT, type PublicUserRow } from './user.select.js';
import { toPublicUser } from './user.mapper.js';

/**
 * Sortable columns are an allow-list. Without it, `?sortBy=passwordHash` would
 * be a working oracle for guessing hashes one ordering at a time.
 */
const SORTABLE_FIELDS = ['createdAt', 'updatedAt', 'name', 'email', 'role', 'lastLoginAt'] as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService,
    private readonly auditService: AuditService,
  ) {}

  async list(query: ListUsersQuery): Promise<{ items: User[]; meta: PaginationMeta }> {
    const where: Prisma.UserWhereInput = {
      ...(query.role ? { role: query.role as Role } : {}),
      ...(typeof query.isActive === 'boolean' ? { isActive: query.isActive } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const result = await paginate<PublicUserRow, Prisma.UserWhereInput, never>(
      this.prisma.user,
      query,
      {
        where,
        select: USER_PUBLIC_SELECT,
        allowedSortFields: SORTABLE_FIELDS,
        defaultSortField: 'createdAt',
      },
    );

    return { items: result.items.map(toPublicUser), meta: result.meta };
  }

  async findById(id: string): Promise<User> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: USER_PUBLIC_SELECT,
    });
    if (!user) throw AppException.notFound('User');

    return toPublicUser(user);
  }

  async create(input: CreateUserInput, actor: AuthenticatedUser, client: ClientInfo): Promise<User> {
    this.assertCanAssignRole(actor, input.role as Role);

    const existing = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });
    if (existing) throw AppException.conflict('A user with this email already exists');

    const passwordHash = await this.passwordService.hash(input.password);

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          name: input.name,
          email: input.email,
          role: input.role as Role,
          isChecker: input.isChecker,
          passwordHash,
        },
        select: { id: true },
      });

      await this.syncNodeAccess(tx, created.id, input.nodeAccess);

      return tx.user.findUniqueOrThrow({ where: { id: created.id }, select: USER_PUBLIC_SELECT });
    });

    await this.auditService.record({
      action: AUDIT_ACTIONS.USER_CREATED,
      entity: 'User',
      entityId: user.id,
      actorId: actor.id,
      actorEmail: actor.email,
      ip: client.ip,
      userAgent: client.userAgent,
      after: user,
    });

    return toPublicUser(user);
  }

  async update(
    id: string,
    input: UpdateUserInput,
    actor: AuthenticatedUser,
    client: ClientInfo,
  ): Promise<User> {
    const target = await this.requireUser(id);

    if (input.email && input.email !== target.email) {
      const clash = await this.prisma.user.findUnique({
        where: { email: input.email },
        select: { id: true },
      });
      if (clash) throw AppException.conflict('A user with this email already exists');
    }

    const user = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.email !== undefined ? { email: input.email } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          ...(input.isChecker !== undefined ? { isChecker: input.isChecker } : {}),
        },
      });

      if (input.nodeAccess !== undefined) {
        await this.syncNodeAccess(tx, id, input.nodeAccess);
      }

      return tx.user.findUniqueOrThrow({ where: { id }, select: USER_PUBLIC_SELECT });
    });

    // Deactivating an account must also cut its live sessions, or the user
    // keeps working until their refresh token happens to expire.
    if (input.isActive === false) {
      await this.tokenService.revokeAllForUser(id);
    }

    await this.auditService.record({
      action: AUDIT_ACTIONS.USER_UPDATED,
      entity: 'User',
      entityId: id,
      actorId: actor.id,
      actorEmail: actor.email,
      ip: client.ip,
      userAgent: client.userAgent,
      before: target,
      after: user,
    });

    return toPublicUser(user);
  }

  async changeRole(
    id: string,
    role: Role,
    actor: AuthenticatedUser,
    client: ClientInfo,
  ): Promise<User> {
    const target = await this.requireUser(id);
    this.assertCanAssignRole(actor, role);

    // SUPER_ADMIN is the role being protected, not ADMIN: it is the only one
    // that can open the Admin Panel, so losing the last of them locks the
    // platform's own configuration away from everybody.
    if (actor.id === id && target.role === ROLES.SUPER_ADMIN && role !== ROLES.SUPER_ADMIN) {
      throw AppException.forbidden('You cannot remove your own super admin role');
    }

    if (target.role === ROLES.SUPER_ADMIN && role !== ROLES.SUPER_ADMIN) {
      await this.assertNotLastSuperAdmin(id);
    }

    const user = await this.prisma.user.update({
      where: { id },
      data: { role },
      select: USER_PUBLIC_SELECT,
    });

    // The old access token still carries the old role until it expires, so the
    // change only really lands once the sessions are gone.
    await this.tokenService.revokeAllForUser(id);

    await this.auditService.record({
      action: AUDIT_ACTIONS.USER_ROLE_CHANGED,
      entity: 'User',
      entityId: id,
      actorId: actor.id,
      actorEmail: actor.email,
      ip: client.ip,
      userAgent: client.userAgent,
      before: target,
      after: user,
    });

    return toPublicUser(user);
  }

  async remove(id: string, actor: AuthenticatedUser, client: ClientInfo): Promise<void> {
    const target = await this.requireUser(id);

    if (actor.id === id) throw AppException.forbidden('You cannot delete your own account');
    if (target.role === ROLES.SUPER_ADMIN) await this.assertNotLastSuperAdmin(id);

    await this.prisma.user.delete({ where: { id } });

    // Sessions cascade with the row; the audit trail does not - AuditLog.actorId
    // is ON DELETE SET NULL and keeps the denormalised email.
    await this.auditService.record({
      action: AUDIT_ACTIONS.USER_DELETED,
      entity: 'User',
      entityId: id,
      actorId: actor.id,
      actorEmail: actor.email,
      ip: client.ip,
      userAgent: client.userAgent,
      before: target,
    });
  }

  /** Counts behind the four cards on the user screen. */
  async stats(): Promise<{ total: number; active: number; inactive: number; newThisMonth: number }> {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const [total, active, newThisMonth] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { isActive: true } }),
      this.prisma.user.count({ where: { createdAt: { gte: startOfMonth } } }),
    ]);

    return { total, active, inactive: total - active, newThisMonth };
  }

  /**
   * Replaces a user's node access with exactly what was sent.
   *
   * Delete-then-insert rather than a diff: the form always submits the complete
   * list, the table is small, and "what is stored is what you saw" is easier to
   * reason about than a merge that can silently keep a row nobody ticked.
   */
  private async syncNodeAccess(
    tx: Prisma.TransactionClient,
    userId: string,
    entries: NodeAccessEntryInput[],
  ): Promise<void> {
    await tx.userNodeAccess.deleteMany({ where: { userId } });
    if (entries.length === 0) return;

    const nodeIds = [...new Set(entries.map((entry) => entry.nodeId))];
    const found = await tx.node.count({ where: { id: { in: nodeIds } } });
    if (found !== nodeIds.length) {
      throw AppException.validation([
        { field: 'nodeAccess', message: 'Ada node yang tidak ditemukan' },
      ]);
    }

    await tx.userNodeAccess.createMany({
      data: entries.map((entry) => ({
        userId,
        nodeId: entry.nodeId,
        role: entry.role as ProjectRole,
        // Only a Collaborator can be handed this; anyone above already has it.
        canCreateDocument: entry.role === 'COLLABORATOR' ? entry.canCreateDocument : false,
      })),
    });
  }

  private async requireUser(id: string): Promise<PublicUserRow> {
    const user = await this.prisma.user.findUnique({ where: { id }, select: USER_PUBLIC_SELECT });
    if (!user) throw AppException.notFound('User');
    return user;
  }

  /** Nobody may mint a role above their own - that is privilege escalation. */
  private assertCanAssignRole(actor: AuthenticatedUser, role: Role): void {
    if (!hasAtLeastRole(actor.role, role)) {
      throw AppException.forbidden('You cannot assign a role above your own');
    }
  }

  private async assertNotLastSuperAdmin(excludingId: string): Promise<void> {
    const remaining = await this.prisma.user.count({
      where: { role: ROLES.SUPER_ADMIN, isActive: true, id: { not: excludingId } },
    });
    if (remaining === 0) {
      throw AppException.forbidden('The last active super admin cannot be removed');
    }
  }
}
