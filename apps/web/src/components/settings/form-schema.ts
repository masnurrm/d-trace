import { z } from 'zod';
import {
  FOOTER_ALIGNMENTS,
  MARQUEE_KINDS,
  SMTP_ENCRYPTIONS,
  updateSettingsSchema,
  type AppSettingsView,
  type UpdateSettingsInput,
} from '@dtrace/shared';
import { isoToLocalInput, localInputToIso } from '@/lib/utils/datetime';

/**
 * The shape the *form controls* hold, which is not the shape the API takes.
 *
 * HTML inputs only produce strings: an empty field is `''`, never `null`, and a
 * `datetime-local` gives wall-clock time with no timezone. This schema
 * describes that, gives the operator immediate feedback in their own language,
 * and `toApiPayload` converts it.
 *
 * It is not a second source of truth: `toApiPayload` runs the result through
 * `updateSettingsSchema` from @dtrace/shared before anything is sent, so the
 * shared contract still has the final word on the client as well as the server.
 */
const emptyToNull = (value: string) => (value.trim() === '' ? null : value.trim());

export const settingsFormSchema = z.object({
  identity: z.object({
    appName: z.string().trim().min(1, 'Nama aplikasi wajib diisi').max(60, 'Maksimal 60 karakter'),
    tagline: z.string().max(120, 'Maksimal 120 karakter'),
  }),

  marquee: z.object({
    enabled: z.boolean(),
    speedSeconds: z
      .string()
      .refine((value) => /^\d+$/.test(value.trim()), 'Isi dengan angka bulat')
      .refine((value) => Number(value) >= 5, 'Minimal 5 detik')
      .refine((value) => Number(value) <= 300, 'Maksimal 300 detik'),
    items: z
      .array(
        z
          .object({
            id: z.string().optional(),
            kind: z.enum(MARQUEE_KINDS),
            text: z.string().trim().min(1, 'Teks wajib diisi').max(500, 'Maksimal 500 karakter'),
            url: z.string().max(2048),
            startsAt: z.string(),
            endsAt: z.string(),
          })
          .refine((item) => item.kind !== 'LINK' || item.url.trim() !== '', {
            message: 'Tautan wajib diisi untuk jenis isi Tautan',
            path: ['url'],
          })
          .refine(
            (item) =>
              !item.startsAt || !item.endsAt || new Date(item.endsAt) > new Date(item.startsAt),
            { message: 'Waktu berhenti harus setelah waktu mulai', path: ['endsAt'] },
          ),
      )
      .max(20, 'Maksimal 20 isi'),
  }),

  footer: z.object({
    text: z.string().max(160, 'Maksimal 160 karakter'),
    align: z.enum(FOOTER_ALIGNMENTS),
    showAppName: z.boolean(),
    showVersion: z.boolean(),
  }),

  email: z
    .object({
      host: z.string().max(255),
      /** A string, because an empty number input yields `''`, not `undefined`. */
      port: z.string(),
      encryption: z.enum(SMTP_ENCRYPTIONS),
      username: z.string().max(255),
      /** Blank means "keep the stored password". */
      password: z.string().max(255),
      fromName: z.string().max(80),
      fromEmail: z.string(),
    })
    .optional(),
});

export type SettingsFormValues = z.infer<typeof settingsFormSchema>;

/** API view -> form values. Nulls become empty strings, instants become local. */
export function toFormValues(settings: AppSettingsView): SettingsFormValues {
  return {
    identity: {
      appName: settings.identity.appName,
      tagline: settings.identity.tagline ?? '',
    },
    marquee: {
      enabled: settings.marquee.enabled,
      speedSeconds: String(settings.marquee.speedSeconds),
      items: settings.marquee.items.map((item) => ({
        id: item.id,
        kind: item.kind,
        text: item.text,
        url: item.url ?? '',
        startsAt: isoToLocalInput(item.startsAt),
        endsAt: isoToLocalInput(item.endsAt),
      })),
    },
    footer: {
      text: settings.footer.text ?? '',
      align: settings.footer.align,
      showAppName: settings.footer.showAppName,
      showVersion: settings.footer.showVersion,
    },
    ...(settings.email
      ? {
          email: {
            host: settings.email.host ?? '',
            port: settings.email.port === null ? '' : String(settings.email.port),
            encryption: settings.email.encryption,
            username: settings.email.username ?? '',
            password: '',
            fromName: settings.email.fromName ?? '',
            fromEmail: settings.email.fromEmail ?? '',
          },
        }
      : {}),
  };
}

/**
 * Form values -> API payload, validated against the shared contract.
 * Throws a `ZodError` if the two ever disagree, which is a bug worth seeing.
 */
export function toApiPayload(
  values: SettingsFormValues,
  expectedUpdatedAt: string | null,
): UpdateSettingsInput {
  const payload = {
    expectedUpdatedAt,
    identity: {
      appName: values.identity.appName.trim(),
      tagline: emptyToNull(values.identity.tagline),
    },
    marquee: {
      enabled: values.marquee.enabled,
      speedSeconds: Number(values.marquee.speedSeconds),
      items: values.marquee.items.map((item) => ({
        ...(item.id ? { id: item.id } : {}),
        kind: item.kind,
        text: item.text.trim(),
        url: item.kind === 'LINK' ? emptyToNull(item.url) : null,
        startsAt: localInputToIso(item.startsAt),
        endsAt: localInputToIso(item.endsAt),
      })),
    },
    footer: {
      text: emptyToNull(values.footer.text),
      align: values.footer.align,
      showAppName: values.footer.showAppName,
      showVersion: values.footer.showVersion,
    },
    ...(values.email
      ? {
          email: {
            host: emptyToNull(values.email.host),
            port: values.email.port.trim() === '' ? null : Number(values.email.port),
            encryption: values.email.encryption,
            username: emptyToNull(values.email.username),
            // Sent only when the operator typed a new one.
            ...(values.email.password.trim() ? { password: values.email.password } : {}),
            fromName: emptyToNull(values.email.fromName),
            fromEmail: emptyToNull(values.email.fromEmail),
          },
        }
      : {}),
  };

  return updateSettingsSchema.parse(payload);
}
