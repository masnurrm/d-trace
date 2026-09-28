import { z } from 'zod';
import { PROJECT_ROLES, type ProjectRole } from './permission.schema.js';

/**
 * The project team.
 *
 * Two facts are kept apart on purpose, because conflating them is how
 * permission systems rot:
 *
 *  - **job role** (TL, PM, BA, …) is *what a person does*. It is a label for
 *    humans and for the mandays columns. It grants nothing.
 *  - **project role** (`ProjectRole`) is *what a person may do*. Anyone added
 *    to a team becomes a COLLABORATOR, because contributing is what being on
 *    a team means; raising someone to Manager or project Admin stays a
 *    deliberate act, never a side effect of picking a job title.
 *
 * On top of that, a single document can carry an override per member — the
 * `DocumentAccess` below. That is the only place a blanket grant gets narrowed
 * or widened for one document, which is what makes a restriction auditable
 * rather than an emergent property of four overlapping rules.
 */

export const PROJECT_JOB_ROLES = [
  'TL',
  'PM',
  'BA',
  'IP_COMPLIANCE',
  'IT_SECURITY',
  'DEVELOPER',
  'QA',
] as const;
export type ProjectJobRole = (typeof PROJECT_JOB_ROLES)[number];

export const PROJECT_JOB_ROLE_LABELS: Record<ProjectJobRole, string> = {
  TL: 'Technical Lead',
  PM: 'Project Manager',
  BA: 'Business Analyst',
  IP_COMPLIANCE: 'IT Compliance',
  IT_SECURITY: 'IT Security',
  DEVELOPER: 'Developer',
  QA: 'QA',
};

/** Short form for a narrow column heading. */
export const PROJECT_JOB_ROLE_SHORT: Record<ProjectJobRole, string> = {
  TL: 'TL',
  PM: 'PM',
  BA: 'BA',
  IP_COMPLIANCE: 'IT Comp.',
  IT_SECURITY: 'IT Sec.',
  DEVELOPER: 'Dev',
  QA: 'QA',
};

/* -------------------------------------------------------------------------- */
/* Membership                                                                  */
/* -------------------------------------------------------------------------- */

export const addProjectMemberSchema = z.object({
  userId: z.uuid('User wajib dipilih'),
  jobRole: z.enum(PROJECT_JOB_ROLES),
  /**
   * Optional, and COLLABORATOR when omitted. Only someone who already manages
   * the project may send anything else; the API refuses the rest.
   */
  projectRole: z.enum(PROJECT_ROLES).default('COLLABORATOR'),
});

export type AddProjectMemberInput = z.infer<typeof addProjectMemberSchema>;

export const updateProjectMemberSchema = z
  .object({
    jobRole: z.enum(PROJECT_JOB_ROLES).optional(),
    projectRole: z.enum(PROJECT_ROLES).optional(),
  })
  .refine((input) => Object.keys(input).length > 0, {
    message: 'Tidak ada perubahan yang dikirim',
  });

export type UpdateProjectMemberInput = z.infer<typeof updateProjectMemberSchema>;

export interface ProjectMemberView {
  id: string;
  userId: string;
  name: string;
  email: string;
  jobRole: ProjectJobRole;
  projectRole: ProjectRole;
  /** True when the grant comes from the node rather than from this team. */
  fromNodeGrant: boolean;
  createdAt: string;
}

/* -------------------------------------------------------------------------- */
/* Per-document access                                                         */
/* -------------------------------------------------------------------------- */

/**
 * What one member may do with one document.
 *
 * `canView` false is a **restriction**: the document leaves that person's
 * sidebar, their lists and their API results entirely. The other three are
 * meaningless without it, which the schema enforces rather than trusting the
 * form to remember.
 */
export const documentAccessSchema = z
  .object({
    userId: z.uuid(),
    canView: z.boolean().default(true),
    canCreate: z.boolean().default(false),
    canEdit: z.boolean().default(false),
    canDelete: z.boolean().default(false),
  })
  .refine(
    (access) => access.canView || (!access.canCreate && !access.canEdit && !access.canDelete),
    {
      message: 'Tanpa izin Lihat, izin lain tidak berlaku',
      path: ['canView'],
    },
  );

export type DocumentAccessInput = z.infer<typeof documentAccessSchema>;

/** The whole access list for one document, saved in one go. */
export const setDocumentAccessSchema = z.object({
  entries: z.array(documentAccessSchema).max(200),
});

export type SetDocumentAccessInput = z.infer<typeof setDocumentAccessSchema>;

/** What the caller may do with one document, after overrides are applied. */
export interface DocumentCapabilities {
  view: boolean;
  create: boolean;
  edit: boolean;
  delete: boolean;
}

export interface DocumentAccessView {
  userId: string;
  name: string;
  email: string;
  jobRole: ProjectJobRole;
  projectRole: ProjectRole;
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  /**
   * False when these values come from the member's role rather than from a
   * stored row — the difference between "allowed because of who they are" and
   * "decided for this document".
   */
  isOverride: boolean;
  /**
   * What this person's role alone would allow, before any override.
   *
   * Sent so the screen can show what "bawaan" actually means and offer a way
   * back to it. Without it, an override could be edited but never undone — the
   * UI would have no idea which values to restore.
   */
  inherited: DocumentCapabilities;
}

/**
 * Folds an override onto the capabilities a role already implies.
 *
 * An absent override inherits; a present one replaces. Replacing rather than
 * merging is what lets a restriction actually restrict — a merge could only
 * ever add, so "this person may not see this document" would be unsayable.
 */
export function resolveDocumentCapabilities(
  inherited: DocumentCapabilities,
  override: Pick<DocumentAccessView, 'canView' | 'canCreate' | 'canEdit' | 'canDelete'> | null,
): DocumentCapabilities {
  if (!override) return inherited;
  if (!override.canView) return { view: false, create: false, edit: false, delete: false };

  return {
    view: true,
    create: override.canCreate,
    edit: override.canEdit,
    delete: override.canDelete,
  };
}
