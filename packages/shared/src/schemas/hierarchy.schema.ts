import { z } from 'zod';
import { paginationQuerySchema } from './common.schema.js';

/**
 * The organisation hierarchy and the rules that govern its shape.
 *
 * Two pieces that only make sense together:
 *
 *  - a **node type** says what a node *is* (Main Company, Department, App) and
 *    where that kind of thing may stand — at the root, or under which types;
 *  - a **node** is one entry in the tree, carrying a type and a parent.
 *
 * Placement is therefore data, not code: an organisation that needs a new level
 * adds a type instead of waiting for a release.
 */

/** `MAIN_COMPANY`, `ESS_HR`, `AGIT` — stable, greppable, safe in a URL. */
export const entityCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .pipe(
    z
      .string()
      .min(2, 'Kode minimal 2 karakter')
      .max(40, 'Kode maksimal 40 karakter')
      .regex(/^[A-Z][A-Z0-9_]*$/, 'Kode hanya boleh huruf kapital, angka, dan garis bawah'),
  );

/* -------------------------------------------------------------------------- */
/* Node types                                                                  */
/* -------------------------------------------------------------------------- */

export const nodeTypeBaseSchema = z.object({
  name: z.string().trim().min(2, 'Nama minimal 2 karakter').max(60, 'Nama maksimal 60 karakter'),
  code: entityCodeSchema,
  /** Whether a node of this type may stand at the top of the tree. */
  canBeRoot: z.boolean().default(false),
  isActive: z.boolean().default(true),
  /**
   * Types that may sit directly above this one. Empty plus `canBeRoot` means
   * "root only"; empty without `canBeRoot` means nothing can ever be placed,
   * which the API rejects rather than accepting a type nobody can use.
   */
  allowedParentIds: z.array(z.uuid()).max(20).default([]),
});

export const createNodeTypeSchema = nodeTypeBaseSchema.refine(
  (type) => type.canBeRoot || type.allowedParentIds.length > 0,
  {
    message: 'Pilih minimal satu induk, atau izinkan jenis ini berdiri sebagai akar',
    path: ['allowedParentIds'],
  },
);

export type CreateNodeTypeInput = z.infer<typeof createNodeTypeSchema>;

export const updateNodeTypeSchema = createNodeTypeSchema;
export type UpdateNodeTypeInput = z.infer<typeof updateNodeTypeSchema>;

export interface NodeTypeView {
  id: string;
  name: string;
  code: string;
  canBeRoot: boolean;
  isActive: boolean;
  allowedParents: { id: string; name: string; code: string }[];
  /** How many nodes currently use this type; a type in use cannot be deleted. */
  nodeCount: number;
  createdAt: string;
  updatedAt: string;
}

/* -------------------------------------------------------------------------- */
/* Nodes                                                                       */
/* -------------------------------------------------------------------------- */

export const createNodeSchema = z.object({
  name: z.string().trim().min(2, 'Nama minimal 2 karakter').max(80, 'Nama maksimal 80 karakter'),
  code: entityCodeSchema,
  typeId: z.uuid('Jenis node wajib dipilih'),
  /** Null places the node at the root, which the type must allow. */
  parentId: z.uuid().nullable().default(null),
});

export type CreateNodeInput = z.infer<typeof createNodeSchema>;

export const updateNodeSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    code: entityCodeSchema.optional(),
    typeId: z.uuid().optional(),
  })
  .refine((input) => Object.keys(input).length > 0, {
    message: 'Tidak ada perubahan yang dikirim',
  });

export type UpdateNodeInput = z.infer<typeof updateNodeSchema>;

export const moveNodeSchema = z.object({
  /** Null moves the node to the root. */
  parentId: z.uuid().nullable(),
});

export type MoveNodeInput = z.infer<typeof moveNodeSchema>;

export const setNodeActivationSchema = z.object({
  ids: z.array(z.uuid()).min(1, 'Pilih minimal satu node').max(500),
  isActive: z.boolean(),
});

export type SetNodeActivationInput = z.infer<typeof setNodeActivationSchema>;

export const listNodesQuerySchema = paginationQuerySchema
  .pick({ search: true })
  .extend({
    typeId: z.uuid().optional(),
    /** Depth is 0-based: 0 is a root. */
    depth: z.coerce.number().int().min(0).max(20).optional(),
    includeInactive: z
      .union([z.boolean(), z.enum(['true', 'false'])])
      .transform((value) => (typeof value === 'boolean' ? value : value === 'true'))
      .default(false),
  });

export type ListNodesQuery = z.infer<typeof listNodesQuerySchema>;

/**
 * One node, flat. The client assembles the tree from `parentId`: the whole
 * hierarchy is small enough to send at once, and one payload keeps expanding,
 * searching and re-parenting instant instead of each costing a round trip.
 */
export interface NodeView {
  id: string;
  name: string;
  code: string;
  parentId: string | null;
  depth: number;
  position: number;
  isActive: boolean;
  type: { id: string; name: string; code: string };
  childCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface HierarchyStats {
  total: number;
  roots: number;
  children: number;
  active: number;
}

/* -------------------------------------------------------------------------- */
/* Tree helpers, shared so the API and the UI agree on the shape               */
/* -------------------------------------------------------------------------- */

export interface TreeNode extends NodeView {
  children: TreeNode[];
}

/** Builds a tree from a flat list. Orphans (parent filtered out) become roots. */
export function buildTree(nodes: NodeView[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  for (const node of nodes) byId.set(node.id, { ...node, children: [] });

  const roots: TreeNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const sort = (list: TreeNode[]) => {
    list.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
    for (const child of list) sort(child.children);
  };
  sort(roots);

  return roots;
}

/** Every descendant id of `nodeId`, itself excluded. */
export function collectDescendantIds(nodes: NodeView[], nodeId: string): string[] {
  const childrenByParent = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const siblings = childrenByParent.get(node.parentId) ?? [];
    siblings.push(node.id);
    childrenByParent.set(node.parentId, siblings);
  }

  const result: string[] = [];
  const queue = [...(childrenByParent.get(nodeId) ?? [])];
  while (queue.length > 0) {
    const current = queue.shift()!;
    result.push(current);
    queue.push(...(childrenByParent.get(current) ?? []));
  }
  return result;
}

export function computeStats(nodes: NodeView[]): HierarchyStats {
  return {
    total: nodes.length,
    roots: nodes.filter((node) => node.parentId === null).length,
    children: nodes.filter((node) => node.parentId !== null).length,
    active: nodes.filter((node) => node.isActive).length,
  };
}
