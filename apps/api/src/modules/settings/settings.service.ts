import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AUDIT_ACTIONS,
  ROLES,
  hasAtLeastRole,
  isMarqueeItemActive,
  type AppSettingsView,
  type EmailSettingsView,
  type MarqueeItemView,
  type Role,
  type UpdateSettingsInput,
} from '@dtrace/shared';
import type { AppConfig } from '../../config/configuration.js';
import { AppException } from '../../common/exceptions/app.exception.js';
import type { ClientInfo } from '../../common/decorators/client-info.decorator.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-request.js';
import { openSecret, sealSecret } from '../../common/utils/secret-box.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AppSetting, MarqueeItem } from '../../generated/prisma/client.js';

/** The row id is fixed by the schema; there is only ever one configuration. */
const SETTINGS_ID = 'singleton';

type SettingsRow = AppSetting & { marqueeItems: MarqueeItem[] };

export interface SmtpCredentials {
  host: string;
  port: number;
  encryption: EmailSettingsView['encryption'];
  username: string | null;
  password: string | null;
  fromName: string | null;
  fromEmail: string;
}

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  /**
   * Reads the settings, creating the row with schema defaults on first call.
   * `role` decides whether the mail section is included at all: it is
   * administrative configuration, so it is omitted rather than blanked.
   */
  async get(role: Role): Promise<AppSettingsView> {
    const row = await this.load();
    return this.toView(row, hasAtLeastRole(role, ROLES.ADMIN));
  }

  async update(
    input: UpdateSettingsInput,
    actor: AuthenticatedUser,
    client: ClientInfo,
  ): Promise<AppSettingsView> {
    const current = await this.load();

    // Optimistic concurrency. Two operators with the page open would otherwise
    // both save, and the second would quietly erase the first one's changes.
    // Present-but-null means "loaded before the first save", which is still a
    // claim about the version; only an absent field opts out of the check.
    if (
      input.expectedUpdatedAt !== undefined &&
      current.updatedAt.toISOString() !== input.expectedUpdatedAt
    ) {
      throw AppException.conflict(
        'Pengaturan sudah diubah di tempat lain. Muat ulang halaman lalu ulangi perubahan Anda.',
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const keptIds = input.marquee.items
        .map((item) => item.id)
        .filter((id): id is string => Boolean(id));

      // Anything the form no longer carries was removed by the operator.
      // With nothing kept, the clause is dropped entirely: `notIn` against a
      // placeholder would make Postgres cast a non-UUID and fail the request.
      await tx.marqueeItem.deleteMany({
        where: {
          settingId: SETTINGS_ID,
          ...(keptIds.length > 0 ? { id: { notIn: keptIds } } : {}),
        },
      });

      // `position` comes from the order the operator sees, so the list keeps
      // its arrangement instead of drifting with insertion time.
      for (const [position, item] of input.marquee.items.entries()) {
        const data = {
          kind: item.kind,
          text: item.text,
          url: item.kind === 'LINK' ? item.url : null,
          startsAt: item.startsAt ? new Date(item.startsAt) : null,
          endsAt: item.endsAt ? new Date(item.endsAt) : null,
          position,
        };

        if (item.id) {
          await tx.marqueeItem.update({ where: { id: item.id }, data });
        } else {
          await tx.marqueeItem.create({ data: { ...data, settingId: SETTINGS_ID } });
        }
      }

      return tx.appSetting.update({
        where: { id: SETTINGS_ID },
        data: {
          appName: input.identity.appName,
          tagline: input.identity.tagline,

          footerText: input.footer.text,
          footerAlign: input.footer.align,
          footerShowAppName: input.footer.showAppName,
          footerShowVersion: input.footer.showVersion,

          marqueeEnabled: input.marquee.enabled,
          marqueeSpeedSeconds: input.marquee.speedSeconds,

          ...(input.email ? this.emailUpdateData(input.email, current) : {}),

          updatedById: actor.id,
        },
        include: { marqueeItems: { orderBy: { position: 'asc' } } },
      });
    });

    await this.auditService.record({
      action: AUDIT_ACTIONS.SETTINGS_UPDATED,
      entity: 'AppSetting',
      entityId: SETTINGS_ID,
      actorId: actor.id,
      actorEmail: actor.email,
      ip: client.ip,
      userAgent: client.userAgent,
      // A summary, not the payload: the payload contains the SMTP password, and
      // `redact()` downstream only recognises it by key name.
      metadata: {
        sections: ['identity', 'marquee', 'footer', ...(input.email ? ['email'] : [])],
        marqueeItems: input.marquee.items.length,
        marqueeEnabled: input.marquee.enabled,
        emailPasswordChanged: Boolean(input.email?.password),
      },
      before: current,
      after: updated,
    });

    return this.toView(updated, true);
  }

  /**
   * Decrypted SMTP credentials for the mailer, or null when mail is not set up.
   * Kept in this service so the ciphertext never leaves it.
   */
  async getSmtpCredentials(): Promise<SmtpCredentials | null> {
    const row = await this.load();
    if (!row.smtpHost || !row.smtpPort || !row.mailFromEmail) return null;

    const secret = this.config.get('settingsSecret', { infer: true });
    const password = row.smtpPassword ? openSecret(row.smtpPassword, secret) : null;

    if (row.smtpPassword && password === null) {
      // Almost always a rotated SETTINGS_SECRET. Say so once, clearly.
      this.logger.error('Stored SMTP password could not be decrypted; re-enter it in Settings');
    }

    return {
      host: row.smtpHost,
      port: row.smtpPort,
      encryption: row.smtpEncryption,
      username: row.smtpUsername,
      password,
      fromName: row.mailFromName,
      fromEmail: row.mailFromEmail,
    };
  }

  recordEmailTest(
    actor: AuthenticatedUser,
    client: ClientInfo,
    to: string,
    outcome: 'sent' | 'failed',
    reason?: string,
  ): void {
    const entry = {
      event: 'settings.email_test',
      outcome,
      to,
      actorId: actor.id,
      actorEmail: actor.email,
      ip: client.ip,
      ...(reason ? { reason } : {}),
    };

    if (outcome === 'failed') this.logger.warn(entry);
    else this.logger.log(entry);
  }

  /** Upsert keeps first boot and every later read on the same path. */
  private async load(): Promise<SettingsRow> {
    return this.prisma.appSetting.upsert({
      where: { id: SETTINGS_ID },
      update: {},
      create: { id: SETTINGS_ID },
      include: { marqueeItems: { orderBy: { position: 'asc' } } },
    });
  }

  /**
   * An empty or absent password means "keep the stored one". Only a non-empty
   * value replaces it, so saving the form does not require re-typing a secret
   * the operator cannot read back.
   */
  private emailUpdateData(email: NonNullable<UpdateSettingsInput['email']>, current: SettingsRow) {
    const secret = this.config.get('settingsSecret', { infer: true });
    const trimmed = email.password?.trim();

    return {
      smtpHost: email.host,
      smtpPort: email.port,
      smtpEncryption: email.encryption,
      smtpUsername: email.username,
      smtpPassword: trimmed ? sealSecret(trimmed, secret) : current.smtpPassword,
      mailFromName: email.fromName,
      mailFromEmail: email.fromEmail || null,
    };
  }

  private toView(row: SettingsRow, includeEmail: boolean): AppSettingsView {
    const now = new Date();

    const items: MarqueeItemView[] = row.marqueeItems.map((item) => {
      const view = {
        id: item.id,
        kind: item.kind,
        text: item.text,
        url: item.url,
        startsAt: item.startsAt ? item.startsAt.toISOString() : null,
        endsAt: item.endsAt ? item.endsAt.toISOString() : null,
      };
      // Computed here so every client agrees on what is live, regardless of
      // how accurate the reader's own clock happens to be.
      return { ...view, isActive: isMarqueeItemActive(view, now) };
    });

    return {
      identity: {
        appName: row.appName,
        tagline: row.tagline,
        version: this.config.get('version', { infer: true }),
      },
      marquee: {
        enabled: row.marqueeEnabled,
        speedSeconds: row.marqueeSpeedSeconds,
        items,
      },
      footer: {
        text: row.footerText,
        align: row.footerAlign,
        showAppName: row.footerShowAppName,
        showVersion: row.footerShowVersion,
      },
      ...(includeEmail
        ? {
            email: {
              host: row.smtpHost,
              port: row.smtpPort,
              encryption: row.smtpEncryption,
              username: row.smtpUsername,
              fromName: row.mailFromName,
              fromEmail: row.mailFromEmail,
              hasPassword: Boolean(row.smtpPassword),
            } satisfies EmailSettingsView,
          }
        : {}),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
