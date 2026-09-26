import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  AUDIT_ACTIONS,
  type SaveSignatureInput,
  type SignatureFont,
  type SignatureKind,
  type UserSignatureView,
} from '@dtrace/shared';
import { AppException } from '../../common/exceptions/app.exception.js';
import type { ClientInfo } from '../../common/decorators/client-info.decorator.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-request.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** What the audit trail sees, on both sides of a change. */
const AUDIT_SELECT = {
  userId: true,
  kind: true,
  font: true,
  code: true,
} as const;

/**
 * The signature belonging to the signed-in person.
 *
 * Every method here works on `actor.id` and never takes a user id from the
 * request. A signature is the one piece of account data where "let an admin
 * edit it for you" is the wrong answer: a mark somebody else can set is not a
 * mark that proves anything.
 */
@Injectable()
export class SignatureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getMine(actor: AuthenticatedUser): Promise<UserSignatureView | null> {
    const row = await this.prisma.userSignature.findUnique({ where: { userId: actor.id } });
    return row ? toView(row) : null;
  }

  async saveMine(
    input: SaveSignatureInput,
    actor: AuthenticatedUser,
    client: ClientInfo,
  ): Promise<UserSignatureView> {
    const existing = await this.prisma.userSignature.findUnique({
      where: { userId: actor.id },
      select: AUDIT_SELECT,
    });

    // The barcode's code is minted once and kept. Re-minting it on every save
    // would quietly invalidate every document already carrying the old one.
    const code =
      input.kind === 'BARCODE'
        ? (existing?.code ?? `DTS-${randomBytes(8).toString('hex').toUpperCase()}`)
        : null;

    const data = input.kind === 'BARCODE' ? null : input.data;
    const font = input.kind === 'TYPED' ? input.font : null;

    const row = await this.prisma.userSignature.upsert({
      where: { userId: actor.id },
      create: { userId: actor.id, kind: input.kind, data, font, code },
      update: { kind: input.kind, data, font, code },
    });

    await this.audit.record({
      action: existing ? AUDIT_ACTIONS.USER_UPDATED : AUDIT_ACTIONS.USER_CREATED,
      entity: 'UserSignature',
      entityId: row.id,
      actorId: actor.id,
      actorEmail: actor.email,
      ip: client.ip,
      userAgent: client.userAgent,
      // The kind, the font and the code are the parts worth keeping. The image
      // and the typed name are left out on purpose - the trail records that a
      // signature changed, not a copy of everybody's signature.
      before: existing ?? undefined,
      after: { userId: row.userId, kind: row.kind, font: row.font, code: row.code },
    });

    return toView(row);
  }

  async removeMine(actor: AuthenticatedUser, client: ClientInfo): Promise<void> {
    const existing = await this.prisma.userSignature.findUnique({
      where: { userId: actor.id },
      select: AUDIT_SELECT,
    });
    if (!existing) throw AppException.notFound('Tanda tangan');

    await this.prisma.userSignature.delete({ where: { userId: actor.id } });

    await this.audit.record({
      action: AUDIT_ACTIONS.USER_UPDATED,
      entity: 'UserSignature',
      entityId: actor.id,
      actorId: actor.id,
      actorEmail: actor.email,
      ip: client.ip,
      userAgent: client.userAgent,
      before: existing,
    });
  }
}

interface SignatureRow {
  kind: string;
  data: string | null;
  font: string | null;
  code: string | null;
  updatedAt: Date;
}

function toView(row: SignatureRow): UserSignatureView {
  return {
    kind: row.kind as SignatureKind,
    data: row.data,
    font: (row.font as SignatureFont | null) ?? null,
    code: row.code,
    updatedAt: row.updatedAt.toISOString(),
  };
}
