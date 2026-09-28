import { z } from 'zod';
import { emailSchema, passwordSchema } from './auth.schema.js';
import { PROJECT_JOB_ROLES, type ProjectJobRole } from './project-team.schema.js';

/**
 * Bringing somebody in who has no account yet.
 *
 * The person being invited has no session and no password, so accepting has to
 * work for an anonymous caller — which makes the link itself the credential.
 * It is therefore treated like one: a long random secret, stored only as a
 * hash, valid once and for a limited time.
 */

export const INVITATION_STATUSES = ['PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED'] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

export const INVITATION_STATUS_LABELS: Record<InvitationStatus, string> = {
  PENDING: 'Belum dijawab',
  ACCEPTED: 'Sudah bergabung',
  EXPIRED: 'Kedaluwarsa',
  REVOKED: 'Dibatalkan',
};

/** Long enough that guessing is hopeless, short enough to survive an email client. */
export const INVITATION_TOKEN_LENGTH = 48;

export const createInvitationSchema = z.object({
  email: emailSchema,
  name: z.string().trim().min(2, 'Nama minimal 2 karakter').max(80),
  /** Set together, or not at all: a role without a project grants nothing. */
  projectId: z.uuid().nullable().default(null),
  jobRole: z.enum(PROJECT_JOB_ROLES).nullable().default(null),
});

export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;

export const acceptInvitationSchema = z
  .object({
    token: z.string().min(16).max(128),
    name: z.string().trim().min(2, 'Nama minimal 2 karakter').max(80),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((input) => input.password === input.confirmPassword, {
    message: 'Konfirmasi password tidak sama',
    path: ['confirmPassword'],
  });

export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;

export interface InvitationView {
  id: string;
  email: string;
  status: InvitationStatus;
  jobRole: ProjectJobRole | null;
  invitedByName: string | null;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
}

/**
 * What the accept page is told before anyone has signed in.
 *
 * Only the email and who sent it — enough for the recipient to recognise the
 * invitation, and nothing that would turn a guessed link into a way of reading
 * the project's name or its members.
 */
export interface InvitationPreview {
  email: string;
  invitedByName: string | null;
  projectName: string | null;
  expiresAt: string;
}
