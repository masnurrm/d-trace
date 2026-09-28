import { z } from 'zod';
import { paginationQuerySchema } from './common.schema.js';
import { PROJECT_ROLES, type PermissionMatrix, type ProjectRole } from './permission.schema.js';

/**
 * The Workspace: what a person actually works on.
 *
 * The shape is three levels deep and each level means something different:
 *
 *   node (an "App", e.g. ESS-HR)  →  project  →  document
 *
 * Access is granted at the **node**, never per project. One grant — "this
 * person is a Collaborator at ESS-HR" — covers every project under it, which
 * is why the access screen asks about nodes and this file never carries a
 * membership list.
 */

/** Ordered: the array order *is* the progression through a project. */
export const PROJECT_STAGES = [
  'PREPARE',
  'DEFINE',
  'DESIGN',
  'DEVELOP',
  'DEPLOY',
  'COMPLETE',
] as const;
export type ProjectStage = (typeof PROJECT_STAGES)[number];

export const PROJECT_STAGE_LABELS: Record<ProjectStage, string> = {
  PREPARE: 'Prepare',
  DEFINE: 'Define',
  DESIGN: 'Design',
  DEVELOP: 'Develop',
  DEPLOY: 'Deploy',
  COMPLETE: 'Complete',
};

export const PROJECT_STATUSES = ['ON_PROGRESS', 'ON_HOLD', 'DONE', 'CANCELLED'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  ON_PROGRESS: 'On Progress',
  ON_HOLD: 'On Hold',
  DONE: 'Selesai',
  CANCELLED: 'Dibatalkan',
};

export const DOCUMENT_STATUSES = ['DRAFT', 'ON_PROGRESS', 'REVIEW', 'FINAL'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const DOCUMENT_STATUS_LABELS: Record<DocumentStatus, string> = {
  DRAFT: 'Draft',
  ON_PROGRESS: 'On Progress',
  REVIEW: 'Review',
  FINAL: 'Final',
};

/** How far along a project is, as the stage stepper draws it. */
export function stageIndex(stage: ProjectStage): number {
  return PROJECT_STAGES.indexOf(stage);
}

/* -------------------------------------------------------------------------- */
/* What a person may do at a node                                              */
/* -------------------------------------------------------------------------- */

/**
 * The capabilities a node grant resolves to, once the permission matrix has
 * been applied to the project role held there.
 *
 * Computed in one place and sent to the client, so the "+" the sidebar offers
 * and the rule the API enforces are the same decision rather than two
 * implementations that can drift apart.
 */
export interface NodeCapabilities {
  viewProject: boolean;
  createProject: boolean;
  viewDocument: boolean;
  createDocument: boolean;
  manageProject: boolean;
  /** The Bug & Issue list — the ISSUE rows of the matrix. */
  viewIssue: boolean;
  createIssue: boolean;
  updateIssue: boolean;
  deleteIssue: boolean;
}

/**
 * Resolves a grant into capabilities.
 *
 * `canCreateDocument` is the single extra a Manager may hand a Collaborator,
 * so it widens creation and nothing else — it is a targeted exception to the
 * matrix, not a second role.
 */
export function resolveNodeCapabilities(
  matrix: PermissionMatrix,
  role: ProjectRole,
  canCreateDocument: boolean,
): NodeCapabilities {
  const allowed = (key: string) => matrix[key]?.[role] ?? false;
  const extra = role === 'COLLABORATOR' && canCreateDocument;

  return {
    viewProject: allowed('project.view'),
    createProject: allowed('project.create') || extra,
    viewDocument: allowed('document.view'),
    createDocument: allowed('document.create') || extra,
    manageProject: allowed('project.settings'),
    // Not widened by `canCreateDocument`: that extra is about documents, and
    // reporting a bug is already a Collaborator's by default.
    viewIssue: allowed('issue.view'),
    createIssue: allowed('issue.create'),
    updateIssue: allowed('issue.update'),
    deleteIssue: allowed('issue.delete'),
  };
}

/* -------------------------------------------------------------------------- */
/* The sidebar tree                                                            */
/* -------------------------------------------------------------------------- */

/** A document as the sidebar and the recent list show it. */
/**
 * The project screens a document row can stand for.
 *
 * These are the things a project produces that are already screens of their
 * own — an estimate, a schedule, a task list, a bug list, the two test
 * scripts (SIT and UAT), which are a grid of scenarios rather than a page, and
 * the implementation plan, which is a runbook timed step by step. They used to be
 * buttons above the document table, which made the table a partial answer to
 * "what does this project produce". Listing them among the documents makes it
 * the whole answer, and clicking one goes to its screen rather than to an
 * editor that has nothing to edit.
 */
export const DOCUMENT_SCREENS = [
  'MANDAYS',
  'TIMELINE',
  'TASKS',
  'BUGS',
  'SIT_SCRIPT',
  'UAT_SCRIPT',
  'IMPLEMENTATION_PLAN',
] as const;
export type DocumentScreen = (typeof DOCUMENT_SCREENS)[number];

/** Where each screen lives, relative to `/workspace/project/{id}`. */
export const DOCUMENT_SCREEN_PATH: Record<DocumentScreen, string> = {
  MANDAYS: 'mandays',
  TIMELINE: 'timeline',
  TASKS: 'tasks',
  BUGS: 'bug-tracking',
  SIT_SCRIPT: 'test-script/sit',
  UAT_SCRIPT: 'test-script/uat',
  IMPLEMENTATION_PLAN: 'implementation-plan',
};

export interface WorkspaceDocumentSummary {
  id: string;
  title: string;
  /** Set when the row is a door to one of the project's screens. */
  screen: DocumentScreen | null;
  /** The master template it was produced from (`BPM`, `RRF`), or null for a blank or uploaded one. */
  templateCode: string | null;
  stage: ProjectStage;
  status: DocumentStatus;
  ownerName: string | null;
  isFavorite: boolean;
  updatedAt: string;
  projectId: string;
  projectName: string;
  nodeId: string;
  nodeName: string;
  /** `IAMI / ESS-IT / Uji Katalog Dokumen`, ready to print under the title. */
  breadcrumb: string;
}

export interface WorkspaceProjectSummary {
  id: string;
  name: string;
  code: string;
  stage: ProjectStage;
  status: ProjectStatus;
  documentCount: number;
  updatedAt: string;
  documents: WorkspaceDocumentSummary[];
}

/** One "App" in the sidebar: a node this person can reach, and what is in it. */
export interface WorkspaceNode {
  id: string;
  name: string;
  code: string;
  /** Names of the ancestors, outermost first — used for the breadcrumb line. */
  path: string[];
  role: ProjectRole;
  capabilities: NodeCapabilities;
  projects: WorkspaceProjectSummary[];
}

export interface WorkspaceTree {
  nodes: WorkspaceNode[];
  /** True when the account reaches everything by virtue of being the platform operator. */
  isPlatformOperator: boolean;
}

/* -------------------------------------------------------------------------- */
/* Projects                                                                    */
/* -------------------------------------------------------------------------- */

export const projectCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .pipe(
    z
      .string()
      .min(2, 'Kode minimal 2 karakter')
      .max(30, 'Kode maksimal 30 karakter')
      .regex(/^[A-Z][A-Z0-9_]*$/, 'Kode hanya boleh huruf kapital, angka, dan garis bawah'),
  );

export const createProjectSchema = z.object({
  nodeId: z.uuid('Node wajib dipilih'),
  name: z.string().trim().min(3, 'Nama minimal 3 karakter').max(120),
  code: projectCodeSchema,
  description: z.string().trim().max(500).nullable().default(null),
  startsAt: z.iso.datetime().nullable().default(null),
  goLiveAt: z.iso.datetime().nullable().default(null),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = z
  .object({
    name: z.string().trim().min(3).max(120).optional(),
    /**
     * Unique within the node, as on create. Nothing points at the code — a
     * document refers to its project by id — so renaming it is a relabelling,
     * not a migration. It is still worth doing deliberately: people quote the
     * code in mail and in meetings, and the audit trail is what connects the
     * old one to the new.
     */
    code: projectCodeSchema.optional(),
    description: z.string().trim().max(500).nullable().optional(),
    status: z.enum(PROJECT_STATUSES).optional(),
    startsAt: z.iso.datetime().nullable().optional(),
    goLiveAt: z.iso.datetime().nullable().optional(),
  })
  .refine((input) => Object.keys(input).length > 0, {
    message: 'Tidak ada perubahan yang dikirim',
  });

export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

/** Everything the Project Space screen renders. */
export interface ProjectView {
  id: string;
  name: string;
  code: string;
  description: string | null;
  stage: ProjectStage;
  status: ProjectStatus;
  startsAt: string | null;
  goLiveAt: string | null;
  node: { id: string; name: string; code: string; path: string[] };
  /** What the *current caller* may do here, resolved from their node grant. */
  capabilities: NodeCapabilities;
  /**
   * Whether the current caller may delete this project: only its creator.
   *
   * Not a capability in the matrix, because it is not a property of a role —
   * a Manager did not make every project they manage, and removing someone
   * else's work is a decision that belongs to whoever started it.
   */
  canDelete: boolean;
  documents: WorkspaceDocumentSummary[];
  /**
   * The team, sent with the project so the avatar row under the title renders
   * with the page instead of appearing a moment later.
   *
   * Typed loosely here to keep this module free of a dependency on the team
   * schema; the concrete shape is `ProjectMemberView`.
   */
  members: { userId: string; name: string; email: string }[];
  /** Per-stage completion, 0-100, derived from document status. */
  progress: { stage: ProjectStage; percent: number; total: number; done: number }[];
  createdAt: string;
  updatedAt: string;
}

/**
 * A stage is "done" in proportion to the documents in it that reached FINAL.
 *
 * A stage with no documents reads 0%, not 100%: an empty stage is work not yet
 * started, and showing it complete would make an untouched project look
 * finished.
 */
export function computeProgress(
  documents: Pick<WorkspaceDocumentSummary, 'stage' | 'status'>[],
): ProjectView['progress'] {
  return PROJECT_STAGES.map((stage) => {
    const inStage = documents.filter((document) => document.stage === stage);
    const done = inStage.filter((document) => document.status === 'FINAL').length;
    return {
      stage,
      total: inStage.length,
      done,
      percent: inStage.length === 0 ? 0 : Math.round((done / inStage.length) * 100),
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Documents                                                                   */
/* -------------------------------------------------------------------------- */

export const createDocumentSchema = z.object({
  projectId: z.uuid('Project wajib dipilih'),
  title: z.string().trim().min(3, 'Judul minimal 3 karakter').max(160),
  /** Null creates a blank document; otherwise it is produced from a template. */
  templateId: z.uuid().nullable().default(null),
  stage: z.enum(PROJECT_STAGES).default('PREPARE'),
});

export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;

export const updateDocumentSchema = z
  .object({
    title: z.string().trim().min(3).max(160).optional(),
    stage: z.enum(PROJECT_STAGES).optional(),
    status: z.enum(DOCUMENT_STATUSES).optional(),
    /** Section content keyed by the template section's `key`. */
    content: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((input) => Object.keys(input).length > 0, {
    message: 'Tidak ada perubahan yang dikirim',
  });

export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>;

export const listDocumentsQuerySchema = paginationQuerySchema.extend({
  projectId: z.uuid().optional(),
  nodeId: z.uuid().optional(),
  stage: z.enum(PROJECT_STAGES).optional(),
  status: z.enum(DOCUMENT_STATUSES).optional(),
  /** Only the caller's starred documents. */
  favorite: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => (typeof value === 'boolean' ? value : value === 'true'))
    .default(false),
});

export type ListDocumentsQuery = z.infer<typeof listDocumentsQuerySchema>;

/**
 * The documents every new project starts with.
 *
 * Created with the project rather than by a later step: a checklist somebody
 * has to remember to add is a checklist that gets forgotten on the projects
 * that most need it. They are real `Document` rows — renameable, deletable,
 * and countable by the stage progress bar — not a second checklist table
 * shadowing the list the project already has.
 *
 * `templateCode` links an entry to a master template when one exists, so
 * "Release Request Form" opens as the actual form instead of an empty
 * template-less document. A code with no template seeded yet is not an error:
 * the document is created blank and can be pointed at a template later.
 *
 * Business Process Model is deliberately absent — it is produced per change
 * request, not once per project.
 */
export const DEFAULT_PROJECT_DOCUMENTS: readonly {
  title: string;
  templateCode?: string;
  screen?: DocumentScreen;
}[] = [
  { title: 'Effort Estimation (Mandays)', screen: 'MANDAYS' },
  { title: 'Project Timeline', screen: 'TIMELINE' },
  { title: 'Project Activity Plan', screen: 'TASKS' },
  { title: 'Business Process Model (BPM)', templateCode: 'BPM' },
  { title: 'Business Blueprint' },
  { title: 'Purchase Order (PO)' },
  { title: 'Release Readiness Checklist', templateCode: 'RRF' },
  { title: 'System Integration Test (SIT) Script', screen: 'SIT_SCRIPT' },
  { title: 'User Acceptance Test (UAT) Script', screen: 'UAT_SCRIPT' },
  { title: 'Security Checklist', templateCode: 'RRF_SEC' },
  { title: 'Implementation Document', screen: 'IMPLEMENTATION_PLAN' },
  { title: 'Bug & Issue List', screen: 'BUGS' },
  { title: 'User Manual' },
  { title: 'Berita Acara Serah Terima (BAST)' },
];

export const setFavoriteSchema = z.object({ favorite: z.boolean() });
export type SetFavoriteInput = z.infer<typeof setFavoriteSchema>;

/** Re-exported so a caller needs one import to talk about a node grant. */
export { PROJECT_ROLES };
export type { ProjectRole };
