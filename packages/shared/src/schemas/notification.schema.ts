import { z } from 'zod';
import { paginationQuerySchema } from './common.schema.js';

/**
 * In-app notifications.
 *
 * One row per recipient, written when the event happens. The alternative — one
 * row per event, fanned out to readers on demand — has nowhere to record "I
 * have read this", and would recompute the audience later against permissions
 * that may have changed in the meantime. Who was told is part of what happened.
 *
 * Email is a *delivery channel*, not a second kind of notification: the same
 * row is mailed when SMTP is configured and simply is not when it is not. That
 * is why `emailedAt` lives here rather than in a separate outbox — the bell and
 * the inbox always agree about what was sent.
 */

export const NOTIFICATION_KINDS = [
  'MANDAY_SUBMITTED',
  'MANDAY_APPROVED',
  'MANDAY_REJECTED',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const NOTIFICATION_KIND_LABELS: Record<NotificationKind, string> = {
  MANDAY_SUBMITTED: 'Estimasi menunggu approval',
  MANDAY_APPROVED: 'Estimasi disetujui',
  MANDAY_REJECTED: 'Estimasi ditolak',
};

export interface NotificationView {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string | null;
  /** App-relative path the row links to, or null when it links nowhere. */
  link: string | null;
  actorName: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationFeed {
  items: NotificationView[];
  /** Unread count across everything, not just the page above. */
  unread: number;
}

export const listNotificationsQuerySchema = paginationQuerySchema.pick({ limit: true }).extend({
  /** Only what has not been read — what the bell opens to by default. */
  unreadOnly: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => (typeof value === 'boolean' ? value : value === 'true'))
    .default(false),
});

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;

/**
 * Marking as read.
 *
 * An explicit id list, or everything. There is no "mark unread": the bell
 * reports what has arrived since you last looked, and letting a row travel
 * backwards would make that count mean nothing.
 */
export const markNotificationsReadSchema = z
  .object({
    ids: z.array(z.uuid()).max(200).optional(),
    all: z.boolean().default(false),
  })
  .refine((input) => input.all || (input.ids?.length ?? 0) > 0, {
    message: 'Sebutkan notifikasi yang dibaca, atau tandai semuanya',
    path: ['ids'],
  });

export type MarkNotificationsReadInput = z.infer<typeof markNotificationsReadSchema>;
