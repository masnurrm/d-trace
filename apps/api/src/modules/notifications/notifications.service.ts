import { Injectable, Logger } from '@nestjs/common';
import {
  type ListNotificationsQuery,
  type MarkNotificationsReadInput,
  type NotificationFeed,
  type NotificationKind,
  type NotificationView,
} from '@dtrace/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { MailerService } from '../settings/mailer.service.js';
import { NotificationsGateway } from './notifications.gateway.js';

/** One event, addressed to a set of people. */
export interface NotifyInput {
  kind: NotificationKind;
  /** Recipients. The actor is filtered out — nobody needs telling what they did. */
  userIds: string[];
  title: string;
  body?: string | null;
  /** App-relative path the row links to. */
  link?: string | null;
  entity?: string | null;
  entityId?: string | null;
  actorId?: string | null;
  actorName?: string | null;
  /** Subject line when mail is configured; no email is sent without one. */
  emailSubject?: string | null;
}

/**
 * In-app notifications, and their delivery by email when mail is configured.
 *
 * `notify()` never throws. It is called from inside the thing it announces —
 * an approval, a submission — and a notification failing must not undo the act
 * that produced it. A missed bell is an annoyance; a rolled-back approval
 * because the mail server was down is a bug nobody would suspect.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
    // Injected lazily would be tidier, but the gateway has no dependency back
    // on this service, so a plain injection has no cycle to avoid.
    private readonly gateway: NotificationsGateway,
  ) {}

  async notify(input: NotifyInput): Promise<void> {
    try {
      // Telling someone about their own action is noise, and it is the one
      // notification guaranteed to be redundant.
      const recipients = [...new Set(input.userIds)].filter((id) => id !== input.actorId);
      if (recipients.length === 0) return;

      const users = await this.prisma.user.findMany({
        where: { id: { in: recipients }, isActive: true },
        select: { id: true, email: true },
      });
      if (users.length === 0) return;

      const emailed = input.emailSubject
        ? await this.mailer.trySend(
            users.map((user) => user.email),
            input.emailSubject,
            [input.title, input.body ?? ''].filter(Boolean).join('\n\n'),
          )
        : false;

      await this.prisma.notification.createMany({
        data: users.map((user) => ({
          userId: user.id,
          kind: input.kind as NotificationKind,
          title: input.title,
          body: input.body ?? null,
          link: input.link ?? null,
          entity: input.entity ?? null,
          entityId: input.entityId ?? null,
          actorName: input.actorName ?? null,
          // Recorded only when the send actually succeeded, so the bell never
          // claims an email that never left.
          emailedAt: emailed ? new Date() : null,
        })),
      });

      // Push after the write, never before: a bell that arrives ahead of the
      // row it announces would show a count the next fetch contradicts.
      await Promise.all(
        users.map(async (user) =>
          this.gateway.emitFeed(user.id, await this.feed(user.id, { limit: 20, unreadOnly: false })),
        ),
      );
    } catch (error) {
      this.logger.error({ err: error, kind: input.kind }, 'Failed to write notifications');
    }
  }

  async feed(userId: string, query: ListNotificationsQuery): Promise<NotificationFeed> {
    const [rows, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId, ...(query.unreadOnly ? { readAt: null } : {}) },
        orderBy: { createdAt: 'desc' },
        take: query.limit,
      }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);

    return { items: rows.map(toView), unread };
  }

  /** Marks rows read. Scoped by user id, so an id from elsewhere does nothing. */
  async markRead(userId: string, input: MarkNotificationsReadInput): Promise<NotificationFeed> {
    await this.prisma.notification.updateMany({
      where: {
        userId,
        readAt: null,
        ...(input.all ? {} : { id: { in: input.ids ?? [] } }),
      },
      data: { readAt: new Date() },
    });

    const feed = await this.feed(userId, { limit: 20, unreadOnly: false });
    // The reader's other tabs are showing a count that is now wrong.
    this.gateway.emitFeed(userId, feed);
    return feed;
  }

  /**
   * Whether mail would go out alongside the bell. The settings screen owns the
   * configuration; this only reports what it currently means for notifications.
   */
  emailEnabled(): Promise<boolean> {
    return this.mailer.isConfigured();
  }
}

function toView(row: {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  actorName: string | null;
  readAt: Date | null;
  createdAt: Date;
}): NotificationView {
  return {
    id: row.id,
    kind: row.kind as NotificationKind,
    title: row.title,
    body: row.body,
    link: row.link,
    actorName: row.actorName,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
