import { z } from 'zod';

/**
 * The project permission matrix.
 *
 * Two halves, deliberately kept apart:
 *
 *  - the **catalog** below is code. Each key names a place in the application
 *    that checks it, so a key with no enforcement point is dead weight and a
 *    check against a key not listed here is a typo waiting to be found.
 *  - the **matrix** (which role gets which permission) is data, editable on the
 *    Role & Akses screen and stored per deployment.
 *
 * Note what this file is *not*: it grants nothing to anybody. Membership of a
 * project, and the role someone holds there, lives with the user.
 */

/** Roles a person can hold *inside a project*. Distinct from the system role. */
export const PROJECT_ROLES = ['ADMIN', 'MANAGER', 'COLLABORATOR', 'VIEWER'] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

export const PROJECT_ROLE_LABELS: Record<ProjectRole, string> = {
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  COLLABORATOR: 'Collaborator',
  VIEWER: 'Viewer',
};

export const PERMISSION_GROUPS = [
  'KONSOL',
  'PROJECT',
  'DOKUMEN',
  'KOMENTAR',
  'TASK',
  'ISSUE',
  'NOTE',
  'AKSES',
] as const;
export type PermissionGroup = (typeof PERMISSION_GROUPS)[number];

/** Icon hints the UI maps to real icons; kept as names so shared stays DOM-free. */
export type PermissionIcon =
  | 'view'
  | 'create'
  | 'edit'
  | 'delete'
  | 'download'
  | 'decision'
  | 'stage'
  | 'settings'
  | 'shield';

export interface PermissionDefinition {
  key: string;
  group: PermissionGroup;
  label: string;
  description: string;
  icon: PermissionIcon;
  /**
   * The permission that must be on for this one to mean anything — creating a
   * document you cannot see is not a coherent grant. Enforced on save.
   */
  requires?: string;
  /**
   * Roles whose cell is fixed and cannot be edited. Used for the admin console,
   * which is a system capability rather than something a project can hand out.
   */
  lockedFor?: ProjectRole[];
}

export const PERMISSIONS: PermissionDefinition[] = [
  {
    key: 'console.access',
    group: 'KONSOL',
    label: 'Akses Konsol Admin',
    description: 'Membuka menu Konsol Admin: user, hierarki, master data, audit log, dan halaman ini.',
    icon: 'shield',
    // Not a project capability at all: it is granted by the system role.
    lockedFor: [...PROJECT_ROLES],
  },

  {
    key: 'project.view',
    group: 'PROJECT',
    label: 'Lihat',
    description: 'Melihat project dan isinya.',
    icon: 'view',
  },
  {
    key: 'project.create',
    group: 'PROJECT',
    label: 'Buat project',
    description: 'Membuat project baru di node ini.',
    icon: 'create',
    requires: 'project.view',
  },
  {
    key: 'project.decision',
    group: 'PROJECT',
    label: 'Catat keputusan',
    description: 'Mencatat keputusan project.',
    icon: 'decision',
    requires: 'project.view',
  },
  {
    key: 'project.stage',
    group: 'PROJECT',
    label: 'Pindah stage, close, dan reopen',
    description: 'Memindahkan stage, close, dan reopen.',
    icon: 'stage',
    requires: 'project.view',
  },
  {
    key: 'project.settings',
    group: 'PROJECT',
    label: 'Kelola setelan',
    description: 'Mengubah setelan project dan node, menghapus project.',
    icon: 'settings',
    requires: 'project.view',
  },

  {
    key: 'document.view',
    group: 'DOKUMEN',
    label: 'Lihat',
    description: 'Melihat dokumen dan riwayat versinya.',
    icon: 'view',
  },
  {
    key: 'document.download',
    group: 'DOKUMEN',
    label: 'Unduh berkas',
    description: 'Mengunduh versi dokumen.',
    icon: 'download',
    requires: 'document.view',
  },
  {
    key: 'document.create',
    group: 'DOKUMEN',
    label: 'Buat',
    description: 'Membuat dokumen baru.',
    icon: 'create',
    requires: 'document.view',
  },
  {
    key: 'document.update',
    group: 'DOKUMEN',
    label: 'Ubah',
    description: 'Mengubah metadata dan mengunggah versi baru.',
    icon: 'edit',
    requires: 'document.view',
  },
  {
    key: 'document.delete',
    group: 'DOKUMEN',
    label: 'Hapus (soft delete)',
    description: 'Menghapus dokumen.',
    icon: 'delete',
    requires: 'document.view',
  },
  {
    key: 'document.decision',
    group: 'DOKUMEN',
    label: 'Catat keputusan',
    description: 'Mencatat keputusan atas dokumen.',
    icon: 'decision',
    requires: 'document.view',
  },

  {
    key: 'comment.view',
    group: 'KOMENTAR',
    label: 'Lihat',
    description: 'Membaca komentar pada dokumen.',
    icon: 'view',
  },
  {
    key: 'comment.create',
    group: 'KOMENTAR',
    label: 'Buat',
    description: 'Menulis komentar.',
    icon: 'create',
    requires: 'comment.view',
  },
  {
    key: 'comment.delete_others',
    group: 'KOMENTAR',
    label: 'Hapus milik orang lain',
    description: 'Menghapus komentar orang lain.',
    icon: 'shield',
    requires: 'comment.view',
  },

  { key: 'task.view', group: 'TASK', label: 'Lihat', description: 'Melihat task.', icon: 'view' },
  {
    key: 'task.create',
    group: 'TASK',
    label: 'Buat',
    description: 'Membuat task.',
    icon: 'create',
    requires: 'task.view',
  },
  {
    key: 'task.update',
    group: 'TASK',
    label: 'Ubah',
    description: 'Mengubah task.',
    icon: 'edit',
    requires: 'task.view',
  },
  {
    key: 'task.delete',
    group: 'TASK',
    label: 'Hapus (soft delete)',
    description: 'Menghapus task.',
    icon: 'delete',
    requires: 'task.view',
  },

  { key: 'issue.view', group: 'ISSUE', label: 'Lihat', description: 'Melihat issue.', icon: 'view' },
  {
    key: 'issue.create',
    group: 'ISSUE',
    label: 'Buat',
    description: 'Membuat issue.',
    icon: 'create',
    requires: 'issue.view',
  },
  {
    key: 'issue.update',
    group: 'ISSUE',
    label: 'Ubah',
    description: 'Mengubah issue.',
    icon: 'edit',
    requires: 'issue.view',
  },
  {
    key: 'issue.delete',
    group: 'ISSUE',
    label: 'Hapus (soft delete)',
    description: 'Menghapus issue.',
    icon: 'delete',
    requires: 'issue.view',
  },

  {
    key: 'note.view',
    group: 'NOTE',
    label: 'Lihat',
    description: 'Melihat catatan tab Other.',
    icon: 'view',
  },
  {
    key: 'note.create',
    group: 'NOTE',
    label: 'Buat',
    description: 'Membuat catatan tab Other.',
    icon: 'create',
    requires: 'note.view',
  },
  {
    key: 'note.update',
    group: 'NOTE',
    label: 'Ubah',
    description: 'Mengubah catatan tab Other.',
    icon: 'edit',
    requires: 'note.view',
  },
  {
    key: 'note.delete',
    group: 'NOTE',
    label: 'Hapus (soft delete)',
    description: 'Menghapus catatan tab Other.',
    icon: 'delete',
    requires: 'note.view',
  },

  {
    key: 'access.manage',
    group: 'AKSES',
    label: 'Kelola setelan',
    description: 'Mengatur izin Collaborator di node ini.',
    icon: 'settings',
  },
];

export const PERMISSION_KEYS = PERMISSIONS.map((permission) => permission.key);

/** The matrix as it travels: `permissionKey -> role -> allowed`. */
export type PermissionMatrix = Record<string, Record<ProjectRole, boolean>>;

/**
 * The shipped baseline, matching the roles as they are meant to work:
 * a Viewer reads, a Collaborator contributes, a Manager runs the project, and
 * a project Admin also owns its settings.
 */
export const DEFAULT_MATRIX: PermissionMatrix = buildDefaults();

function buildDefaults(): PermissionMatrix {
  const grant = (
    admin: boolean,
    manager: boolean,
    collaborator: boolean,
    viewer: boolean,
  ): Record<ProjectRole, boolean> => ({ ADMIN: admin, MANAGER: manager, COLLABORATOR: collaborator, VIEWER: viewer });

  const none = grant(false, false, false, false);
  const everyone = grant(true, true, true, true);
  const contributors = grant(true, true, true, false);
  const leads = grant(true, true, false, false);

  const defaults: PermissionMatrix = {
    'console.access': none,

    'project.view': everyone,
    'project.create': leads,
    'project.decision': leads,
    'project.stage': leads,
    'project.settings': grant(true, false, false, false),

    'document.view': everyone,
    'document.download': everyone,
    'document.create': contributors,
    'document.update': contributors,
    'document.delete': contributors,
    'document.decision': leads,

    'comment.view': everyone,
    'comment.create': everyone,
    'comment.delete_others': leads,

    'task.view': everyone,
    'task.create': contributors,
    'task.update': contributors,
    'task.delete': contributors,

    'issue.view': everyone,
    'issue.create': contributors,
    'issue.update': contributors,
    'issue.delete': contributors,

    'note.view': everyone,
    'note.create': contributors,
    'note.update': contributors,
    'note.delete': contributors,

    'access.manage': leads,
  };

  return defaults;
}

/* -------------------------------------------------------------------------- */
/* Wire format                                                                 */
/* -------------------------------------------------------------------------- */

const roleFlagsSchema = z.object({
  ADMIN: z.boolean(),
  MANAGER: z.boolean(),
  COLLABORATOR: z.boolean(),
  VIEWER: z.boolean(),
});

export const updatePermissionMatrixSchema = z.object({
  /** The version the editor loaded; a stale save is refused, not merged. */
  expectedUpdatedAt: z.iso.datetime().nullable().optional(),
  matrix: z.record(z.string(), roleFlagsSchema),
});

export type UpdatePermissionMatrixInput = z.infer<typeof updatePermissionMatrixSchema>;

export interface PermissionMatrixView {
  matrix: PermissionMatrix;
  updatedAt: string | null;
  /** Who last saved it, for the "changed by" line. */
  updatedByEmail: string | null;
}

/* -------------------------------------------------------------------------- */
/* Rules                                                                       */
/* -------------------------------------------------------------------------- */

export interface MatrixViolation {
  permissionKey: string;
  role: ProjectRole;
  message: string;
}

/**
 * Checks the two invariants the matrix must always satisfy, so a nonsense
 * configuration is caught once here instead of everywhere it would be read:
 *
 *  1. a dependent permission requires its parent (no "create" without "view");
 *  2. a locked cell keeps its default and cannot be handed to a project role.
 */
export function findMatrixViolations(matrix: PermissionMatrix): MatrixViolation[] {
  const violations: MatrixViolation[] = [];

  for (const permission of PERMISSIONS) {
    const row = matrix[permission.key];
    if (!row) continue;

    for (const role of PROJECT_ROLES) {
      if (permission.lockedFor?.includes(role) && row[role] !== DEFAULT_MATRIX[permission.key]?.[role]) {
        violations.push({
          permissionKey: permission.key,
          role,
          message: `"${permission.label}" tidak bisa diberikan kepada ${PROJECT_ROLE_LABELS[role]}.`,
        });
        continue;
      }

      if (permission.requires && row[role] && matrix[permission.requires]?.[role] === false) {
        const parent = PERMISSIONS.find((candidate) => candidate.key === permission.requires);
        violations.push({
          permissionKey: permission.key,
          role,
          message: `${PROJECT_ROLE_LABELS[role]} tidak bisa "${permission.label}" tanpa "${parent?.label ?? permission.requires}".`,
        });
      }
    }
  }

  return violations;
}

/** Fills in anything the stored matrix is missing, so a new key is never undefined. */
export function withDefaults(stored: Partial<PermissionMatrix>): PermissionMatrix {
  const result: PermissionMatrix = {};

  for (const permission of PERMISSIONS) {
    const fallback = DEFAULT_MATRIX[permission.key] ?? {
      ADMIN: false,
      MANAGER: false,
      COLLABORATOR: false,
      VIEWER: false,
    };
    result[permission.key] = { ...fallback, ...(stored[permission.key] ?? {}) };
  }

  return result;
}
