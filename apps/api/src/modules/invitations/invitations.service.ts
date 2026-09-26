import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  AUDIT_ACTIONS,
  INVITATION_TOKEN_LENGTH,
  type AcceptInvitationInput,
  type CreateInvitationInput,
  type InvitationPreview,
  type InvitationStatus,
  type InvitationView,
  type ProjectJobRole,
} from '@dtrace/shared';
import { AppException } from '../../common/exceptions/app.exception.js';
import type { ClientInfo } from '../../common/decorators/client-info.decorator.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-request.js';
import type { AppConfig } from '../../config/configuration.js';
import { AuditService } from '../audit/audit.service.js';
import { PasswordService } from '../auth/password.service.js';
import { MailerService } from '../settings/mailer.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Long enough that the link is unguessable and short enough to survive email. */
const TOKEN_BYTES = 32;

/** An invitation nobody answered stops working; it is not a permanent key. */
const VALID_FOR_DAYS = 7;

const hashOf = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * Invitations for people who have no account yet.
 *
 * Accepting has to work for a caller with no session, so the link itself is
 * the credential — and it is handled like one. The secret is generated here,
 * sent once by email, and kept only as a SHA-256 hash: a copy of this table
 * yields no working links.
 */
@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mailer: MailerService,
    private readonly passwords: PasswordService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async create(
    input: CreateInvitationInput,
    actor: AuthenticatedUser,
    client: ClientInfo,
  ): Promise<InvitationView> {
    const existing = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });
    if (existing) {
      throw AppException.conflict('Email itu sudah punya akun. Cari namanya di daftar user.');
    }

    /*
     * An address with an invitation still outstanding is refused, not
     * re-invited.
     *
     * Two live links to one account is one more than anybody needs, and the
     * caller almost never meant it — a second click, a double click, or two
     * people inviting the same person. Whoever wants a fresh link revokes the
     * old one first, which is a deliberate act with a button of its own.
     *
     * This check is the courteous answer. The guarantee is the partial unique
     * index on (email) WHERE status = 'PENDING': two requests racing here both
     * see nothing and both try to insert, and the database refuses the second.
     */
    const outstanding = await this.prisma.invitation.findFirst({
      where: { email: input.email, status: 'PENDING' },
      select: { id: true },
    });
    if (outstanding) {
      throw AppException.conflict(
        'Undangan untuk email ini sudah dikirim dan belum dijawab. Batalkan dulu bila ingin mengirim ulang.',
      );
    }

    const token = randomBytes(TOKEN_BYTES).toString('base64url').slice(0, INVITATION_TOKEN_LENGTH);
    const expiresAt = new Date(Date.now() + VALID_FOR_DAYS * 86_400_000);

    let row;
    try {
      row = await this.prisma.invitation.create({
        data: {
          email: input.email,
          tokenHash: hashOf(token),
          expiresAt,
          projectId: input.projectId,
          jobRole: input.jobRole as ProjectJobRole | null,
          invitedById: actor.id,
        },
        include: { invitedBy: { select: { name: true } } },
      });
    } catch (error) {
      // P2002 here is the partial unique index: another request won the race.
      // The caller asked for one invitation and there is one, so this reads as
      // the same refusal rather than as a failure.
      if ((error as { code?: string }).code === 'P2002') {
        throw AppException.conflict(
          'Undangan untuk email ini sudah dikirim dan belum dijawab. Batalkan dulu bila ingin mengirim ulang.',
        );
      }
      throw error;
    }

    /*
     * The first allowed origin *is* the web app's address — the list exists so
     * the API knows which browser origin to trust, and that is the same thing
     * a link has to point at. A separate WEB_URL setting would be a second
     * copy of one fact, free to disagree with the first.
     */
    const origin = this.config.get('corsOrigins', { infer: true })[0] ?? 'http://localhost:3000';
    const link = `${origin.replace(/\/+$/, '')}/undangan/${token}`;
    const sent = await this.mailer.trySendTo(
      input.email,
      'Anda diundang ke D-Trace',
      [
        `Halo ${input.name},`,
        '',
        `${actor.email} mengundang Anda bergabung ke D-Trace.`,
        '',
        'Buka tautan berikut untuk membuat password dan mengaktifkan akun Anda:',
        link,
        '',
        `Tautan ini berlaku sampai ${expiresAt.toLocaleDateString('id-ID')} dan hanya bisa dipakai sekali.`,
        'Bila Anda tidak mengharapkan undangan ini, abaikan saja email ini.',
      ].join('\n'),
    );

    if (!sent) {
      // The row stays: an operator can resend rather than lose the invitation
      // because the mail server had a bad minute.
      this.logger.warn({ email: input.email }, 'Invitation email could not be sent');
    }

    await this.audit.record({
      action: AUDIT_ACTIONS.INVITATION_SENT,
      entity: 'Invitation',
      entityId: row.id,
      actorId: actor.id,
      actorEmail: actor.email,
      ip: client.ip,
      userAgent: client.userAgent,
      // The token is never recorded — not here, not anywhere.
      after: { email: row.email, status: row.status, projectId: row.projectId, jobRole: row.jobRole },
      metadata: { emailSent: sent },
    });

    return toView(row);
  }

  async listForProject(projectId: string): Promise<InvitationView[]> {
    const rows = await this.prisma.invitation.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      include: { invitedBy: { select: { name: true } } },
    });

    return rows.map(toView);
  }

  /**
   * What the accept page may show before anybody has signed in.
   *
   * A wrong or spent token answers 404 rather than explaining itself: the page
   * is public, and "this invitation exists but expired" is more than a stranger
   * with a guessed link should learn.
   */
  async preview(token: string): Promise<InvitationPreview> {
    const row = await this.findUsable(token);

    const project = row.projectId
      ? await this.prisma.project.findUnique({
          where: { id: row.projectId, deletedAt: null },
          select: { name: true },
        })
      : null;

    const invitedBy = row.invitedById
      ? await this.prisma.user.findUnique({
          where: { id: row.invitedById },
          select: { name: true },
        })
      : null;

    return {
      email: row.email,
      invitedByName: invitedBy?.name ?? null,
      projectName: project?.name ?? null,
      expiresAt: row.expiresAt.toISOString(),
    };
  }

  /**
   * Turns an invitation into an account.
   *
   * One transaction: the user, the project membership and the invitation's own
   * closure land together. A half-applied acceptance would leave a live link
   * beside an account that already exists.
   */
  async accept(input: AcceptInvitationInput, client: ClientInfo): Promise<void> {
    const row = await this.findUsable(input.token);

    const clash = await this.prisma.user.findUnique({
      where: { email: row.email },
      select: { id: true },
    });
    if (clash) throw AppException.conflict('Akun untuk email ini sudah dibuat.');

    const passwordHash = await this.passwords.hash(input.password);

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { email: row.email, name: input.name, passwordHash },
        select: { id: true, email: true },
      });

      if (row.projectId) {
        await tx.projectMember.create({
          data: {
            projectId: row.projectId,
            userId: created.id,
            jobRole: (row.jobRole ?? 'BA') as ProjectJobRole,
          },
        });
      }

      await tx.invitation.update({
        where: { id: row.id },
        data: { status: 'ACCEPTED', acceptedAt: new Date(), acceptedUserId: created.id },
      });

      return created;
    });

    await this.audit.record({
      action: AUDIT_ACTIONS.INVITATION_ACCEPTED,
      entity: 'Invitation',
      entityId: row.id,
      // The new account is the actor: nobody else was present.
      actorId: user.id,
      actorEmail: user.email,
      ip: client.ip,
      userAgent: client.userAgent,
      before: { email: row.email, status: 'PENDING' as InvitationStatus },
      after: { email: row.email, status: 'ACCEPTED' as InvitationStatus },
    });
  }

  async revoke(id: string, actor: AuthenticatedUser, client: ClientInfo): Promise<void> {
    const row = await this.prisma.invitation.findUnique({ where: { id } });
    if (!row || row.status !== 'PENDING') throw AppException.notFound('Undangan');

    await this.prisma.invitation.update({ where: { id }, data: { status: 'REVOKED' } });

    await this.audit.record({
      action: AUDIT_ACTIONS.INVITATION_REVOKED,
      entity: 'Invitation',
      entityId: id,
      actorId: actor.id,
      actorEmail: actor.email,
      ip: client.ip,
      userAgent: client.userAgent,
      before: { email: row.email, status: row.status },
      after: { email: row.email, status: 'REVOKED' as InvitationStatus },
    });
  }

  /**
   * Finds the invitation a token names, or refuses.
   *
   * The lookup is by hash, so the stored value is useless to anyone who reads
   * the table. The comparison is still made in constant time: the row is found
   * by an indexed hash, and the hash is then checked again against the
   * candidate so a partial match cannot be detected by how long the reply took.
   */
  private async findUsable(token: string) {
    const tokenHash = hashOf(token);

    const row = await this.prisma.invitation.findUnique({
      where: { tokenHash },
      include: { invitedBy: { select: { name: true } } },
    });

    if (!row) throw AppException.notFound('Undangan');

    const a = Buffer.from(row.tokenHash);
    const b = Buffer.from(tokenHash);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw AppException.notFound('Undangan');

    if (row.status !== 'PENDING') throw AppException.notFound('Undangan');

    if (row.expiresAt.getTime() < Date.now()) {
      await this.prisma.invitation.update({ where: { id: row.id }, data: { status: 'EXPIRED' } });
      throw AppException.notFound('Undangan');
    }

    return row;
  }
}

interface InvitationRow {
  id: string;
  email: string;
  status: string;
  jobRole: string | null;
  expiresAt: Date;
  acceptedAt: Date | null;
  createdAt: Date;
  invitedBy: { name: string } | null;
}

function toView(row: InvitationRow): InvitationView {
  return {
    id: row.id,
    email: row.email,
    status: row.status as InvitationStatus,
    jobRole: (row.jobRole as ProjectJobRole | null) ?? null,
    invitedByName: row.invitedBy?.name ?? null,
    expiresAt: row.expiresAt.toISOString(),
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
