import { z } from 'zod';

/**
 * Application settings: the identity shown in the shell, the header marquee,
 * the footer, and the outgoing mail configuration.
 *
 * One schema pair per section. The API validates the same objects the settings
 * form produces, so a rule added here is enforced on both sides at once.
 */

export const FOOTER_ALIGNMENTS = ['LEFT', 'CENTER', 'RIGHT'] as const;
export type FooterAlignment = (typeof FOOTER_ALIGNMENTS)[number];

export const MARQUEE_KINDS = ['TEXT', 'LINK'] as const;
export type MarqueeKind = (typeof MARQUEE_KINDS)[number];

export const SMTP_ENCRYPTIONS = ['NONE', 'STARTTLS', 'SSL_TLS'] as const;
export type SmtpEncryption = (typeof SMTP_ENCRYPTIONS)[number];

/* -------------------------------------------------------------------------- */
/* Identity                                                                    */
/* -------------------------------------------------------------------------- */

export const identitySettingsSchema = z.object({
  appName: z.string().trim().min(1, 'Nama aplikasi wajib diisi').max(60),
  tagline: z.string().trim().max(120).nullable().default(null),
});

export type IdentitySettingsInput = z.infer<typeof identitySettingsSchema>;

/* -------------------------------------------------------------------------- */
/* Marquee                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A scheduled announcement. `startsAt`/`endsAt` are absolute instants (ISO
 * strings): the form collects wall-clock time in the operator's timezone and
 * converts before sending, so an item means the same moment for every reader.
 */
export const marqueeItemSchema = z
  .object({
    /** Absent on a row the operator has just added and not yet saved. */
    id: z.uuid().optional(),
    kind: z.enum(MARQUEE_KINDS).default('TEXT'),
    text: z.string().trim().min(1, 'Teks wajib diisi').max(500),
    url: z.url('Tautan tidak valid').max(2048).nullable().default(null),
    startsAt: z.iso.datetime().nullable().default(null),
    endsAt: z.iso.datetime().nullable().default(null),
  })
  .refine((item) => item.kind !== 'LINK' || Boolean(item.url), {
    message: 'Tautan wajib diisi untuk jenis isi Tautan',
    path: ['url'],
  })
  .refine(
    (item) =>
      !item.startsAt || !item.endsAt || new Date(item.endsAt) > new Date(item.startsAt),
    {
      // An end before its start is never what the operator meant, and would
      // silently produce an item that can never appear.
      message: 'Waktu berhenti harus setelah waktu mulai',
      path: ['endsAt'],
    },
  );

export type MarqueeItemInput = z.infer<typeof marqueeItemSchema>;

export const marqueeSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  /** Seconds for one full pass. Larger is slower. */
  speedSeconds: z.coerce
    .number()
    .int()
    .min(5, 'Minimal 5 detik')
    .max(300, 'Maksimal 300 detik')
    .default(15),
  items: z.array(marqueeItemSchema).max(20, 'Maksimal 20 isi').default([]),
});

export type MarqueeSettingsInput = z.infer<typeof marqueeSettingsSchema>;

/* -------------------------------------------------------------------------- */
/* Footer                                                                      */
/* -------------------------------------------------------------------------- */

export const footerSettingsSchema = z.object({
  text: z.string().trim().max(160).nullable().default(null),
  align: z.enum(FOOTER_ALIGNMENTS).default('CENTER'),
  showAppName: z.boolean().default(true),
  showVersion: z.boolean().default(true),
});

export type FooterSettingsInput = z.infer<typeof footerSettingsSchema>;

/* -------------------------------------------------------------------------- */
/* Email                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * `password` is write-only: it is accepted here but never returned by the API.
 * An empty string means "leave the stored password alone", which is what lets
 * the form be saved without re-typing the secret every time.
 */
export const emailSettingsSchema = z
  .object({
    host: z.string().trim().max(255).nullable().default(null),
    port: z.coerce.number().int().min(1).max(65535).nullable().default(null),
    encryption: z.enum(SMTP_ENCRYPTIONS).default('STARTTLS'),
    username: z.string().trim().max(255).nullable().default(null),
    password: z.string().max(255).optional(),
    fromName: z.string().trim().max(80).nullable().default(null),
    fromEmail: z.union([z.email('Email pengirim tidak valid'), z.literal('')])
      .nullable()
      .default(null),
  })
  .refine((email) => !email.host || email.port !== null, {
    message: 'Port wajib diisi bila host diisi',
    path: ['port'],
  })
  .refine((email) => !email.host || Boolean(email.fromEmail), {
    message: 'Email pengirim wajib diisi bila host diisi',
    path: ['fromEmail'],
  });

export type EmailSettingsInput = z.infer<typeof emailSettingsSchema>;

/* -------------------------------------------------------------------------- */
/* The whole document                                                          */
/* -------------------------------------------------------------------------- */

export const updateSettingsSchema = z.object({
  /**
   * The `updatedAt` the editor loaded. When it no longer matches the stored
   * row, someone else has saved in the meantime and this payload is built on a
   * stale view - the API rejects it rather than silently discarding their work.
   * Optional so a script can still write deliberately without one.
   */
  expectedUpdatedAt: z.iso.datetime().nullable().optional(),
  identity: identitySettingsSchema,
  marquee: marqueeSettingsSchema,
  footer: footerSettingsSchema,
  /** Only an administrator may send this section; the API enforces that. */
  email: emailSettingsSchema.optional(),
});

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

export const testEmailSchema = z.object({
  to: z.email('Alamat tujuan tidak valid'),
});

export type TestEmailInput = z.infer<typeof testEmailSchema>;

/* -------------------------------------------------------------------------- */
/* What the API returns                                                        */
/* -------------------------------------------------------------------------- */

export interface MarqueeItemView {
  id: string;
  kind: MarqueeKind;
  text: string;
  url: string | null;
  startsAt: string | null;
  endsAt: string | null;
  /** Computed server-side, so every client agrees on what is live right now. */
  isActive: boolean;
}

export interface EmailSettingsView {
  host: string | null;
  port: number | null;
  encryption: SmtpEncryption;
  username: string | null;
  fromName: string | null;
  fromEmail: string | null;
  /** The password itself is never sent; this only says whether one is stored. */
  hasPassword: boolean;
}

export interface AppSettingsView {
  identity: {
    appName: string;
    tagline: string | null;
    /** Read from the build. Not editable — see `settings.service.ts`. */
    version: string;
  };
  marquee: {
    enabled: boolean;
    speedSeconds: number;
    items: MarqueeItemView[];
  };
  footer: {
    text: string | null;
    align: FooterAlignment;
    showAppName: boolean;
    showVersion: boolean;
  };
  /** Present for administrators only. */
  email?: EmailSettingsView;
  updatedAt: string | null;
}

/** True when `now` falls inside the item's window; an open end is unbounded. */
export function isMarqueeItemActive(
  item: { startsAt: string | null; endsAt: string | null },
  now: Date = new Date(),
): boolean {
  const instant = now.getTime();
  if (item.startsAt && new Date(item.startsAt).getTime() > instant) return false;
  if (item.endsAt && new Date(item.endsAt).getTime() <= instant) return false;
  return true;
}
