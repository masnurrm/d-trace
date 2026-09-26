import { isEntryPoint, prisma, runAsScript } from './seed-client.js';

/**
 * The placement grammar and the organisation tree.
 *
 * These were typed in by hand on one machine and existed nowhere else, so a
 * fresh clone came up with an empty Hierarki and no way to create a project.
 * They are code now for the same reason the document templates are: a starting
 * point every install shares, and one that can be read in a diff.
 *
 * Nothing here is overwritten. A node type or node whose `code` already exists
 * is left exactly as it is — somebody may have renamed it, moved it or
 * deactivated it deliberately, and a seed that reverted that would undo real
 * work on every run.
 */

interface NodeTypeSeed {
  code: string;
  name: string;
  /** May a node of this type stand at the top of the tree? */
  canBeRoot?: boolean;
  /** Codes of the types allowed directly above this one. */
  allowedParents?: string[];
}

/**
 * Order is the `position` column: it decides how the types are listed on the
 * Jenis Node screen, and reading down it is the tree from the top.
 */
const NODE_TYPES: NodeTypeSeed[] = [
  { code: 'MAIN_COMPANY', name: 'Main Company', canBeRoot: true },
  { code: 'DEPARTMENT', name: 'Department', allowedParents: ['MAIN_COMPANY'] },
  { code: 'PROJECT_DEPARTMENT', name: 'Project Department', allowedParents: ['DEPARTMENT'] },
  {
    code: 'COMPANY_PROJECT_DEPARTMENT',
    name: 'Company Project Department',
    allowedParents: ['PROJECT_DEPARTMENT'],
  },
  { code: 'APP', name: 'App', allowedParents: ['COMPANY_PROJECT_DEPARTMENT'] },
];

interface NodeSeed {
  code: string;
  name: string;
  /** A `NodeTypeSeed.code`. */
  type: string;
  /** A `NodeSeed.code`, or null for a root. */
  parent: string | null;
}

/**
 * A parent always appears before its children, because each row is created
 * with the parent already in hand — and `depth` is counted from it rather than
 * written down here, so the two can never disagree.
 */
const NODES: NodeSeed[] = [
  { code: 'AGIT', name: 'AGIT', type: 'MAIN_COMPANY', parent: null },
  { code: 'MS', name: 'Manage Service', type: 'DEPARTMENT', parent: 'AGIT' },
  { code: 'ASMO3', name: 'ASMO3', type: 'PROJECT_DEPARTMENT', parent: 'MS' },
  { code: 'IAMI', name: 'IAMI', type: 'COMPANY_PROJECT_DEPARTMENT', parent: 'ASMO3' },
  { code: 'ESS_BUDGET', name: 'ESS-Budget', type: 'APP', parent: 'IAMI' },
  { code: 'ESS_HR', name: 'ESS-HR', type: 'APP', parent: 'IAMI' },
  { code: 'ESS_IT', name: 'ESS-IT', type: 'APP', parent: 'IAMI' },
];

export async function seedHierarchy(): Promise<void> {
  const typeIdByCode = await seedNodeTypes();
  await seedNodes(typeIdByCode);
}

/**
 * Creates the missing types, then wires the placement rules.
 *
 * Two passes, because `allowedParents` points at other types in the same list:
 * a single pass would have to connect to rows that do not exist yet. The
 * second pass only touches types this run created — an existing type's rules
 * are somebody's decision, not this file's.
 */
async function seedNodeTypes(): Promise<Map<string, string>> {
  const idByCode = new Map<string, string>();
  const fresh: NodeTypeSeed[] = [];

  for (const [position, seed] of NODE_TYPES.entries()) {
    const existing = await prisma.nodeType.findUnique({
      where: { code: seed.code },
      select: { id: true, name: true },
    });

    if (existing) {
      idByCode.set(seed.code, existing.id);
      console.log(`- jenis node ${seed.code} (${existing.name}) sudah ada, dilewati.`);
      continue;
    }

    const created = await prisma.nodeType.create({
      data: {
        code: seed.code,
        name: seed.name,
        canBeRoot: seed.canBeRoot ?? false,
        position,
      },
      select: { id: true },
    });

    idByCode.set(seed.code, created.id);
    fresh.push(seed);
    console.log(`+ jenis node ${seed.code} (${seed.name}) dibuat.`);
  }

  for (const seed of fresh) {
    const parents = seed.allowedParents ?? [];
    if (parents.length === 0) continue;

    await prisma.nodeType.update({
      where: { code: seed.code },
      data: { allowedParents: { connect: parents.map((code) => ({ code })) } },
    });
    console.log(`  ${seed.code} boleh berada di bawah: ${parents.join(', ')}`);
  }

  return idByCode;
}

async function seedNodes(typeIdByCode: Map<string, string>): Promise<void> {
  // Carries both facts a child needs from its parent, so the tree is walked once.
  const placed = new Map<string, { id: string; depth: number }>();

  // Siblings are numbered per parent, which is what `position` means.
  const nextPosition = new Map<string, number>();

  for (const seed of NODES) {
    const existing = await prisma.node.findUnique({
      where: { code: seed.code },
      select: { id: true, name: true, depth: true },
    });

    if (existing) {
      placed.set(seed.code, { id: existing.id, depth: existing.depth });
      console.log(`- node ${seed.code} (${existing.name}) sudah ada, dilewati.`);
      continue;
    }

    const typeId = typeIdByCode.get(seed.type);
    if (!typeId) {
      // Only reachable if NODE_TYPES and NODES drift apart in this file.
      throw new Error(`Node ${seed.code} refers to unknown node type ${seed.type}.`);
    }

    const parent = seed.parent ? placed.get(seed.parent) : null;
    if (seed.parent && !parent) {
      throw new Error(`Node ${seed.code} must be listed after its parent ${seed.parent}.`);
    }

    const parentKey = seed.parent ?? '';
    const position = nextPosition.get(parentKey) ?? 0;
    nextPosition.set(parentKey, position + 1);

    const created = await prisma.node.create({
      data: {
        code: seed.code,
        name: seed.name,
        typeId,
        parentId: parent?.id ?? null,
        position,
        depth: parent ? parent.depth + 1 : 0,
      },
      select: { id: true, depth: true },
    });

    placed.set(seed.code, { id: created.id, depth: created.depth });
    console.log(`+ node ${seed.code} (${seed.name}) dibuat di kedalaman ${created.depth}.`);
  }
}

if (isEntryPoint(import.meta.url)) runAsScript(seedHierarchy);
