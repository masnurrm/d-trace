import { z } from 'zod';
import { paginationQuerySchema } from './common.schema.js';

/**
 * Master document templates: the blueprint a document is produced from.
 *
 * A template is an ordered list of **sections**. Every section names a
 * component type (a header block, a paragraph, a process flow, a table, an
 * approval strip) and carries a `config` object whose shape is decided by that
 * type — which is why the section schema below is a discriminated union rather
 * than one object with a bag of optional fields.
 *
 * Two axes govern what ends up on the page:
 *
 *  - **component type** decides how the section renders;
 *  - **data source** decides where its content comes from — pulled from the
 *    project, typed by the user filling the document, or both.
 *
 * Inside a config, a cell marked `FIXED` is written once here in the master
 * template and is the same in every document; a cell marked `INPUT` is left
 * blank for whoever fills the document in. That distinction is the whole point
 * of the builder, so it lives in the contract instead of in the UI.
 */

export const TEMPLATE_COMPONENT_TYPES = [
  'HEADER',
  'INFO',
  'TEXT',
  'FLOW',
  'TABLE',
  'APPROVAL',
  'CHECKLIST',
  'DATA',
] as const;
export type TemplateComponentType = (typeof TEMPLATE_COMPONENT_TYPES)[number];

/** Indonesian labels for the component picker, kept next to the values. */
export const TEMPLATE_COMPONENT_LABELS: Record<TemplateComponentType, string> = {
  HEADER: 'Document Header',
  INFO: 'Project Information',
  TEXT: 'Text / Paragraph',
  FLOW: 'Process Flow',
  TABLE: 'Activity Table',
  APPROVAL: 'Approval Signature',
  CHECKLIST: 'Verification Checklist',
  DATA: 'Project Data (Mandays)',
};

export const TEMPLATE_DATA_SOURCES = ['PROJECT', 'MANUAL', 'MIXED', 'SYSTEM'] as const;
export type TemplateDataSource = (typeof TEMPLATE_DATA_SOURCES)[number];

export const TEMPLATE_DATA_SOURCE_LABELS: Record<TemplateDataSource, string> = {
  PROJECT: 'Project Data',
  MANUAL: 'Manual Input',
  MIXED: 'Project + Manual',
  SYSTEM: 'System Generated',
};

/**
 * Who owns a piece of content. `FIXED` is decided here and reproduced in every
 * document; `INPUT` is a blank the document author fills.
 */
export const CELL_MODES = ['FIXED', 'INPUT'] as const;
export type CellMode = (typeof CELL_MODES)[number];

/**
 * A generated identifier for a node, edge, row or column inside a config. It is
 * produced by the browser and only has to be unique within its own section, so
 * it is not constrained to a UUID.
 */
const localIdSchema = z.string().trim().min(1).max(40);

/** Any text that may carry `{{project.field}}` placeholders. */
const contentTextSchema = z.string().max(2000);

/* -------------------------------------------------------------------------- */
/* Component configs                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The masthead: a confidential banner, a three-cell identification strip, the
 * yellow document title, and the title line beneath it.
 */
export const headerConfigSchema = z.object({
  confidentialLabel: z.string().trim().max(60).default('CONFIDENTIAL'),
  logoText: z.string().trim().max(40).default('agit'),
  /** An uploaded logo; when set it replaces `logoText` in the left cell. */
  logoAssetId: z.uuid().nullable().default(null),
  /**
   * Lines in the middle identification cell, first line rendered in bold.
   *
   * A line may reserve a blank with `{{input:Label}}` — "BPM No." is the
   * template's, the number after it is the document's. See `headerInputs()`.
   */
  centerLines: z.array(contentTextSchema).max(4).default([]),
  /** Lines in the right identification cell, first line rendered in bold. */
  rightLines: z.array(contentTextSchema).max(4).default([]),
  /**
   * How many leading lines of each cell print large and bold. One by default;
   * a BPM prints both "BPM No." and the number itself that way.
   */
  centerBoldLines: z.number().int().min(0).max(4).default(1),
  rightBoldLines: z.number().int().min(0).max(4).default(1),
  documentTitle: z.string().trim().max(120).default('BUSINESS PROCESS MAPPING'),
  titleLabel: z.string().trim().max(40).default('Title'),
  titleValue: contentTextSchema.default('{{project.name}}'),
});

export type HeaderConfig = z.infer<typeof headerConfigSchema>;

/**
 * `{{input:No. CRF}}` — a blank inside a header line, answered per document.
 *
 * The header is otherwise the template's own text, but a BPM's number and its
 * CRF reference are the document's, and they print *in* the header rather than
 * in the information grid below it. The answer is stored under `inputKey()` of
 * the label, so the same label on two lines is one answer printed twice.
 */
const HEADER_INPUT_PATTERN = /\{\{\s*input:([^}]{1,60})\}\}/g;

export function inputKey(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Every blank the header reserves, in reading order, without duplicates. */
export function headerInputs(config: HeaderConfig): { key: string; label: string }[] {
  const seen = new Map<string, string>();
  for (const line of [...config.centerLines, ...config.rightLines, config.titleValue]) {
    for (const match of line.matchAll(HEADER_INPUT_PATTERN)) {
      const label = match[1]!.trim();
      const key = inputKey(label);
      if (key && !seen.has(key)) seen.set(key, label);
    }
  }
  return [...seen].map(([key, label]) => ({ key, label }));
}

/**
 * Splits a header line into literal text and input blanks, so a renderer can
 * draw a control (or the answer) in place of each blank.
 */
export function splitHeaderLine(
  line: string,
): ({ kind: 'text'; text: string } | { kind: 'input'; key: string; label: string })[] {
  const parts: ({ kind: 'text'; text: string } | { kind: 'input'; key: string; label: string })[] =
    [];
  let last = 0;
  for (const match of line.matchAll(HEADER_INPUT_PATTERN)) {
    const index = match.index ?? 0;
    if (index > last) parts.push({ kind: 'text', text: line.slice(last, index) });
    const label = match[1]!.trim();
    parts.push({ kind: 'input', key: inputKey(label), label });
    last = index + match[0].length;
  }
  if (last < line.length) parts.push({ kind: 'text', text: line.slice(last) });
  return parts;
}

/**
 * What kind of blank an `INPUT` info row is.
 *
 * A Release Request Form asks for a priority, a deployment window and a
 * downtime in hours and minutes. Those are not free text — a priority typed by
 * hand is a priority nobody can filter on, and a date typed by hand is a date
 * in whatever format the typist happens to prefer. The template says which kind
 * each row is, and the document renders the control that kind implies.
 *
 * `TEXT` is the default, so every row written before this stays what it was.
 */
export const INFO_FIELD_KINDS = [
  'TEXT',
  'TEXTAREA',
  'SELECT',
  'NUMBER',
  'DATE',
  'DATETIME',
  'DATE_RANGE',
  'DATETIME_RANGE',
  'DURATION',
] as const;
export type InfoFieldKind = (typeof INFO_FIELD_KINDS)[number];

export const INFO_FIELD_KIND_LABELS: Record<InfoFieldKind, string> = {
  TEXT: 'Teks singkat',
  TEXTAREA: 'Teks panjang',
  SELECT: 'Pilihan',
  NUMBER: 'Angka',
  DATE: 'Tanggal',
  DATETIME: 'Tanggal & jam',
  DATE_RANGE: 'Rentang tanggal',
  DATETIME_RANGE: 'Rentang tanggal & jam',
  DURATION: 'Durasi (dua satuan)',
};

/** The kinds whose answer is two values rather than one. */
export function isPairField(kind: InfoFieldKind): boolean {
  return kind === 'DATE_RANGE' || kind === 'DATETIME_RANGE' || kind === 'DURATION';
}

/** One label/value pair in the project information grid. */
export const infoRowSchema = z.object({
  id: localIdSchema,
  label: z.string().trim().max(80).default(''),
  value: contentTextSchema.default(''),
  mode: z.enum(CELL_MODES).default('FIXED'),
  /** `full` spans the remaining width; `half` leaves room for a second pair. */
  span: z.enum(['half', 'full']).default('full'),
  /** Which control an `INPUT` row offers. Ignored on a `FIXED` row. */
  field: z.enum(INFO_FIELD_KINDS).default('TEXT'),
  /** The choices, for `SELECT`. Empty for every other kind. */
  options: z.array(z.string().trim().max(80)).max(40).default([]),
  /**
   * The two unit captions a `DURATION` row prints beside its boxes — "Jam"
   * and "Menit" on the release form. Unused by the other kinds.
   */
  units: z.array(z.string().trim().max(16)).max(2).default([]),
  /** Shown beside the label, for a row whose meaning needs a word. */
  hint: z.string().trim().max(120).default(''),
});

export type InfoRow = z.infer<typeof infoRowSchema>;

export const infoConfigSchema = z.object({
  rows: z.array(infoRowSchema).max(40).default([]),
});

export type InfoConfig = z.infer<typeof infoConfigSchema>;

export const textConfigSchema = z.object({
  placeholder: z.string().trim().max(200).default(''),
  /** Height of the blank the document author writes into, in text rows. */
  minRows: z.number().int().min(1).max(30).default(3),
});

export type TextConfig = z.infer<typeof textConfigSchema>;

/**
 * A process flow laid out on a grid.
 *
 * Nodes carry a `row`/`col` instead of pixel coordinates: the editor grows the
 * diagram by adding a neighbour up, right, down or left of the selected node,
 * and a grid is exactly the model that operation implies. An edge between two
 * orthogonally adjacent nodes is drawn as an arrow in the gap between them;
 * anything further apart is still recorded, so moving a node never loses a
 * connection.
 */
export const flowNodeSchema = z.object({
  id: localIdSchema,
  label: z.string().trim().max(60).default(''),
  row: z.number().int().min(0).max(40),
  col: z.number().int().min(0).max(40),
  mode: z.enum(CELL_MODES).default('FIXED'),
});

export type FlowNode = z.infer<typeof flowNodeSchema>;

export const flowEdgeSchema = z.object({
  id: localIdSchema,
  from: localIdSchema,
  to: localIdSchema,
});

export type FlowEdge = z.infer<typeof flowEdgeSchema>;

export const flowConfigSchema = z
  .object({
    nodes: z.array(flowNodeSchema).max(120).default([]),
    edges: z.array(flowEdgeSchema).max(200).default([]),
  })
  .superRefine((config, ctx) => {
    const ids = new Set(config.nodes.map((node) => node.id));
    if (ids.size !== config.nodes.length) {
      ctx.addIssue({ code: 'custom', message: 'Node flow memiliki id ganda', path: ['nodes'] });
    }

    // Two nodes on one grid cell would render on top of each other.
    const cells = new Set(config.nodes.map((node) => `${node.row}:${node.col}`));
    if (cells.size !== config.nodes.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'Ada dua node pada posisi yang sama',
        path: ['nodes'],
      });
    }

    config.edges.forEach((edge, index) => {
      if (!ids.has(edge.from) || !ids.has(edge.to)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Panah menunjuk ke node yang sudah tidak ada',
          path: ['edges', index],
        });
      }
    });
  });

export type FlowConfig = z.infer<typeof flowConfigSchema>;

export const tableColumnSchema = z.object({
  id: localIdSchema,
  label: z.string().trim().max(80).default(''),
  /** Percentage of the table width; null lets the browser decide. */
  width: z.number().int().min(3).max(100).nullable().default(null),
  align: z.enum(['left', 'center', 'right']).default('left'),
});

export type TableColumn = z.infer<typeof tableColumnSchema>;

export const tableCellSchema = z.object({
  value: contentTextSchema.default(''),
  mode: z.enum(CELL_MODES).default('INPUT'),
});

export type TableCell = z.infer<typeof tableCellSchema>;

/**
 * A grid whose size the template author sets (rows × columns). Cells prefilled
 * here are `FIXED` and reappear in every document; the rest are `INPUT` blanks.
 */
export const tableConfigSchema = z
  .object({
    columns: z.array(tableColumnSchema).min(1, 'Tabel butuh minimal satu kolom').max(12),
    /** Row-major, `rows.length × columns.length`. */
    rows: z.array(z.array(tableCellSchema).max(12)).max(60).default([]),
    showHeader: z.boolean().default(true),
    /** Whether the document author may append rows of their own. */
    allowUserRows: z.boolean().default(false),
    /** Prepend an automatic 1..n column on render. */
    numbered: z.boolean().default(true),
  })
  .superRefine((config, ctx) => {
    const width = config.columns.length;
    config.rows.forEach((row, index) => {
      if (row.length !== width) {
        // A ragged grid renders as a broken table; reject it at the boundary
        // rather than patching it on the way out.
        ctx.addIssue({
          code: 'custom',
          message: `Baris ${index + 1} punya ${row.length} sel, seharusnya ${width}`,
          path: ['rows', index],
        });
      }
    });
  });

export type TableConfig = z.infer<typeof tableConfigSchema>;

/** One signature box. The count of these is what "1 / 2 / 3 kolom" means. */
export const approvalColumnSchema = z.object({
  id: localIdSchema,
  /** The role being asked to sign: "Technical Lead", "User Representative". */
  label: z.string().trim().max(80).default(''),
  /** Text above the box: "Approved by", "Prepared by", "Acknowledged by". */
  prefix: z.string().trim().max(40).default('Approved by'),
  /** A name printed under the line, or a blank for the signer to fill. */
  name: z.string().trim().max(80).default(''),
  mode: z.enum(CELL_MODES).default('INPUT'),
  showDate: z.boolean().default(false),
});

export type ApprovalColumn = z.infer<typeof approvalColumnSchema>;

export const approvalConfigSchema = z.object({
  columns: z
    .array(approvalColumnSchema)
    .min(1, 'Minimal satu kolom tanda tangan')
    .max(6, 'Maksimal enam kolom tanda tangan'),
  /** Height of each signature box in pixels, as it prints. */
  boxHeight: z.number().int().min(40).max(220).default(90),
});

export type ApprovalConfig = z.infer<typeof approvalConfigSchema>;

/* -------------------------------------------------------------------------- */
/* Image attachments                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The image types a template may carry. Raster only: an SVG is a document that
 * can hold script, and these are served inline into every document built from
 * the template.
 */
export const TEMPLATE_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
] as const;
export type TemplateImageMimeType = (typeof TEMPLATE_IMAGE_MIME_TYPES)[number];

/** Per image, not per request: a template is a form, not a photo album. */
export const TEMPLATE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export const TEMPLATE_IMAGE_WIDTHS = ['small', 'medium', 'full'] as const;
export type TemplateImageWidth = (typeof TEMPLATE_IMAGE_WIDTHS)[number];

export const TEMPLATE_IMAGE_WIDTH_LABELS: Record<TemplateImageWidth, string> = {
  small: 'Kecil (1/3)',
  medium: 'Sedang (2/3)',
  full: 'Penuh',
};

/**
 * One image printed under a section — a logo, a diagram, a sample screen.
 *
 * The section only *points* at the uploaded asset; the bytes are a row of their
 * own, uploaded before the template is saved. `fileName` is carried here so the
 * inspector can name the image without a second request.
 */
export const templateAttachmentSchema = z.object({
  /** The `DocumentTemplateAsset` id the upload returned. */
  assetId: z.uuid(),
  fileName: z.string().trim().max(200).default(''),
  caption: z.string().trim().max(200).default(''),
  width: z.enum(TEMPLATE_IMAGE_WIDTHS).default('medium'),
});

export type TemplateAttachment = z.infer<typeof templateAttachmentSchema>;

/** What the upload endpoint answers with. */
export interface TemplateAssetView {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

/** The URL a browser loads an asset from, through the BFF. */
export function templateAssetUrl(assetId: string): string {
  return `/api/bff/document-templates/assets/${assetId}`;
}

/* -------------------------------------------------------------------------- */
/* Sections                                                                    */
/* -------------------------------------------------------------------------- */

/** Everything a section carries regardless of which component it is. */
const sectionBaseShape = {
  /** Absent on a section the operator has just added and not yet saved. */
  id: z.uuid().optional(),
  title: z.string().trim().min(1, 'Judul section wajib diisi').max(120),
  /**
   * The stable handle a document refers to this section by. Renaming the title
   * is cosmetic; changing the key breaks documents already bound to it.
   */
  key: z
    .string()
    .trim()
    .min(2, 'Key minimal 2 karakter')
    .max(60, 'Key maksimal 60 karakter')
    .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, 'Key hanya boleh huruf, angka, dan garis bawah'),
  source: z.enum(TEMPLATE_DATA_SOURCES).default('MANUAL'),
  /** Where project data is read from, e.g. `project.scopeOfWork`. */
  binding: z.string().trim().max(120).nullable().default(null),
  /** Default or placeholder body, used by TEXT and as a fallback elsewhere. */
  content: contentTextSchema.nullable().default(null),
  editable: z.boolean().default(true),
  required: z.boolean().default(false),
  visible: z.boolean().default(true),
  /** Images printed under the section, in order. Any component type may carry them. */
  attachments: z.array(templateAttachmentSchema).max(10, 'Maksimal 10 gambar per section').default([]),
};

/**
 * The section, discriminated by component type so each one validates exactly
 * the config it uses. Adding a component means adding a branch here — which is
 * what stops a FLOW section from being saved with a table's config.
 */
/* -------------------------------------------------------------------------- */
/* Checklist                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * What a checker may say about one item.
 *
 * Two of them settle an item — `CLOSED` and `NO_NEED` — and two say it is
 * still open: `NEED` (it applies, nobody has started) and `IN_PROGRESS`. A form
 * is submittable only when every item is settled. "Not looked at yet" is the
 * absence of an answer, so it is `null` rather than a value — a release where
 * somebody actively chose a placeholder on every line would count as answered,
 * which is the opposite of what the form is for.
 *
 * `CLOSED` replaced `DONE`; answers saved before are read as `CLOSED` by the
 * content schema, so no document needs migrating.
 */
export const CHECKLIST_RESULTS = ['NO_NEED', 'NEED', 'IN_PROGRESS', 'CLOSED'] as const;
export type ChecklistResult = (typeof CHECKLIST_RESULTS)[number];

export const CHECKLIST_RESULT_LABELS: Record<ChecklistResult, string> = {
  NO_NEED: 'No Need',
  NEED: 'Need',
  IN_PROGRESS: 'In Progress',
  CLOSED: 'Closed',
};

/** The results that finish an item. Anything else, `null` included, is outstanding. */
export const CHECKLIST_SETTLED_RESULTS: readonly ChecklistResult[] = ['CLOSED', 'NO_NEED'];

export interface ChecklistTally {
  counts: Record<ChecklistResult, number>;
  /** Items nobody has answered. */
  unanswered: number;
  /** Items not yet CLOSED or NO_NEED — what blocks a submit. */
  outstanding: number;
  /** Share of items settled, 0–100. */
  settledPercent: number;
}

/**
 * One count of a checklist's answers, so the form screen and the generic
 * editor cannot disagree about what "outstanding" means.
 */
export function tallyChecklist(results: readonly (ChecklistResult | null)[]): ChecklistTally {
  const counts = Object.fromEntries(CHECKLIST_RESULTS.map((result) => [result, 0])) as Record<
    ChecklistResult,
    number
  >;
  let unanswered = 0;
  for (const result of results) {
    if (result === null) unanswered += 1;
    else counts[result] += 1;
  }
  const settled = CHECKLIST_SETTLED_RESULTS.reduce((sum, result) => sum + counts[result], 0);
  return {
    counts,
    unanswered,
    outstanding: results.length - settled,
    settledPercent: results.length === 0 ? 0 : (settled / results.length) * 100,
  };
}

export const checklistItemSchema = z.object({
  id: localIdSchema,
  label: z.string().trim().min(1).max(1000),
  /** Optional cross-group reading order, used when domains are interleaved. */
  position: z.number().int().min(1).max(1000).optional(),
  /**
   * What the item actually asks for, under its name — "min. TLS 1.2", "maks. 4
   * akun". Optional: a release checklist's lines are self-explanatory, a
   * security checklist's are not, and the standard is the name *and* this.
   */
  description: z.string().trim().max(500).default(''),
});

export type ChecklistItem = z.infer<typeof checklistItemSchema>;

export const checklistGroupSchema = z.object({
  id: localIdSchema,
  title: z.string().trim().max(120).default(''),
  items: z.array(checklistItemSchema).max(80).default([]),
});

export type ChecklistGroup = z.infer<typeof checklistGroupSchema>;

/**
 * A verification checklist: named items, grouped, each answered by a checker.
 *
 * The items belong to the template — they are the standard every release is
 * held to, and a checker who could add or rename lines could quietly shorten
 * it. What the document owns is the answers, which is why this config carries
 * no results and the content carries no labels.
 *
 * The four detail columns are switchable because not every checklist needs all
 * of them, and a column of empty boxes teaches people to leave boxes empty.
 */
export const checklistConfigSchema = z.object({
  groups: z.array(checklistGroupSchema).max(20).default([]),
  /** Printed above the table: who fills this in. */
  filledByLabel: z.string().trim().max(120).default(''),
  showRemark: z.boolean().default(true),
  showChecker: z.boolean().default(true),
  showDate: z.boolean().default(true),
  showEvidence: z.boolean().default(true),
});

export type ChecklistConfig = z.infer<typeof checklistConfigSchema>;

/** Every item across every group, in reading order. */
export function checklistItems(config: ChecklistConfig): ChecklistItem[] {
  return config.groups.flatMap((group) => group.items);
}

/* -------------------------------------------------------------------------- */
/* Project data                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Tables a document does not type but *takes* from another screen.
 *
 * A BPM's "Effort & Resource Needed" and "Plan & Activity" are the mandays
 * estimate, laid out for a reader. Retyping them would give the project two
 * estimates free to disagree, so the section names a dataset and the API
 * produces the numbers. The document keeps a snapshot (see `dataContentSchema`)
 * because a signed BPM has to keep saying what it said when it was signed.
 */
export const PROJECT_DATASETS = ['MANDAY_EFFORT', 'MANDAY_ACTIVITY'] as const;
export type ProjectDataset = (typeof PROJECT_DATASETS)[number];

export const PROJECT_DATASET_LABELS: Record<ProjectDataset, string> = {
  MANDAY_EFFORT: 'Effort & Resource (mandays per role per minggu)',
  MANDAY_ACTIVITY: 'Plan & Activity (task mandays per tahap)',
};

export const dataConfigSchema = z.object({
  dataset: z.enum(PROJECT_DATASETS).default('MANDAY_ACTIVITY'),
  /** A sentence printed above the table. */
  intro: z.string().trim().max(500).default(''),
  /** Effort only: the week-by-week spread, when the timeline has dates. */
  showWeeks: z.boolean().default(true),
  /** Effort only: "Resource yang dibutuhkan", counted from the project team. */
  showResources: z.boolean().default(true),
});

export type DataConfig = z.infer<typeof dataConfigSchema>;

export const templateSectionSchema = z.discriminatedUnion('type', [
  z.object({ ...sectionBaseShape, type: z.literal('HEADER'), config: headerConfigSchema }),
  z.object({ ...sectionBaseShape, type: z.literal('INFO'), config: infoConfigSchema }),
  z.object({ ...sectionBaseShape, type: z.literal('TEXT'), config: textConfigSchema }),
  z.object({ ...sectionBaseShape, type: z.literal('FLOW'), config: flowConfigSchema }),
  z.object({ ...sectionBaseShape, type: z.literal('TABLE'), config: tableConfigSchema }),
  z.object({ ...sectionBaseShape, type: z.literal('APPROVAL'), config: approvalConfigSchema }),
  z.object({ ...sectionBaseShape, type: z.literal('CHECKLIST'), config: checklistConfigSchema }),
  z.object({ ...sectionBaseShape, type: z.literal('DATA'), config: dataConfigSchema }),
]);

export type TemplateSectionInput = z.infer<typeof templateSectionSchema>;

/** A saved section: the same shape, with the server-assigned fields present. */
export type TemplateSectionView = TemplateSectionInput & {
  id: string;
  position: number;
};

/* -------------------------------------------------------------------------- */
/* Templates                                                                   */
/* -------------------------------------------------------------------------- */

/** `BPM`, `FSD`, `UAT` — stable, greppable, safe in a URL. */
export const templateCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .pipe(
    z
      .string()
      .min(2, 'Kode minimal 2 karakter')
      .max(20, 'Kode maksimal 20 karakter')
      .regex(/^[A-Z][A-Z0-9_]*$/, 'Kode hanya boleh huruf kapital, angka, dan garis bawah'),
  );

export const templateMetaSchema = z.object({
  name: z.string().trim().min(3, 'Nama minimal 3 karakter').max(120),
  code: templateCodeSchema,
  version: z
    .string()
    .trim()
    .min(1, 'Versi wajib diisi')
    .max(20)
    .regex(/^[0-9][0-9.]*$/, 'Versi hanya boleh angka dan titik'),
  description: z.string().trim().max(500).nullable().default(null),
  isActive: z.boolean().default(true),
});

export const createDocumentTemplateSchema = templateMetaSchema;
export type CreateDocumentTemplateInput = z.infer<typeof createDocumentTemplateSchema>;

/**
 * The builder saves the whole template in one request: the section list is an
 * ordering, and sending it piecemeal would leave the document half-rearranged
 * if one call failed. `expectedUpdatedAt` is the version the editor loaded —
 * without it, a tab left open overwrites whatever was saved meanwhile.
 */
export const updateDocumentTemplateSchema = templateMetaSchema.extend({
  expectedUpdatedAt: z.iso.datetime().optional(),
  sections: z
    .array(templateSectionSchema)
    .max(80, 'Maksimal 80 section dalam satu template')
    .default([])
    .superRefine((sections, ctx) => {
      const seen = new Set<string>();
      sections.forEach((section, index) => {
        const key = section.key.toLowerCase();
        if (seen.has(key)) {
          ctx.addIssue({
            code: 'custom',
            message: `Key "${section.key}" dipakai lebih dari sekali`,
            path: [index, 'key'],
          });
        }
        seen.add(key);
      });
    }),
});

export type UpdateDocumentTemplateInput = z.infer<typeof updateDocumentTemplateSchema>;

export const listDocumentTemplatesQuerySchema = paginationQuerySchema.extend({
  includeInactive: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => (typeof value === 'boolean' ? value : value === 'true'))
    .default(false),
});

export type ListDocumentTemplatesQuery = z.infer<typeof listDocumentTemplatesQuerySchema>;

/** A row in the template list: metadata only, no sections. */
export interface DocumentTemplateSummary {
  id: string;
  name: string;
  code: string;
  version: string;
  description: string | null;
  isActive: boolean;
  sectionCount: number;
  createdAt: string;
  updatedAt: string;
}

/** One template with everything the builder needs to render it. */
export interface DocumentTemplateView extends DocumentTemplateSummary {
  sections: TemplateSectionView[];
}

/* -------------------------------------------------------------------------- */
/* Helpers shared by the builder and the renderer                              */
/* -------------------------------------------------------------------------- */

/** A fresh config for a component type, so a type change never leaves a gap. */
export function defaultConfigFor(type: TemplateComponentType, makeId: () => string): unknown {
  switch (type) {
    case 'HEADER':
      return headerConfigSchema.parse({
        centerLines: ['BPM No.', '{{project.code}}'],
        rightLines: ['Microsoft Solution Center', 'Astra Graphia - IT'],
      });
    case 'INFO':
      return infoConfigSchema.parse({
        rows: [
          { id: makeId(), label: 'User Name', value: '', mode: 'INPUT', span: 'half' },
          { id: makeId(), label: 'Phone/HP/Email', value: '', mode: 'INPUT', span: 'half' },
          { id: makeId(), label: 'Company', value: '', mode: 'INPUT', span: 'full' },
        ],
      });
    case 'TEXT':
      return textConfigSchema.parse({ placeholder: 'Isi bagian ini...', minRows: 3 });
    case 'FLOW':
      return flowConfigSchema.parse({
        nodes: [{ id: makeId(), label: 'Mulai', row: 0, col: 0, mode: 'FIXED' }],
        edges: [],
      });
    case 'TABLE': {
      const columns = [
        { id: makeId(), label: 'Activity', width: null, align: 'left' as const },
        { id: makeId(), label: 'Start Date', width: 20, align: 'center' as const },
        { id: makeId(), label: 'End Date', width: 20, align: 'center' as const },
      ];
      return tableConfigSchema.parse({
        columns,
        rows: Array.from({ length: 3 }, () =>
          columns.map(() => ({ value: '', mode: 'INPUT' as const })),
        ),
      });
    }
    case 'APPROVAL':
      return approvalConfigSchema.parse({
        columns: [
          { id: makeId(), label: 'Technical Lead', prefix: 'Approved by', mode: 'INPUT' },
          { id: makeId(), label: 'Technical Advisor', prefix: 'Approved by', mode: 'INPUT' },
          { id: makeId(), label: 'User Representative', prefix: 'Approved by', mode: 'INPUT' },
        ],
      });
    case 'CHECKLIST':
      return checklistConfigSchema.parse({
        groups: [
          {
            id: makeId(),
            title: 'Kelompok baru',
            items: [
              { id: makeId(), label: 'Item pertama' },
              { id: makeId(), label: 'Item kedua' },
            ],
          },
        ],
      });
    case 'DATA':
      return dataConfigSchema.parse({});
  }
}

/**
 * Substitutes `{{project.field}}` placeholders from a context object.
 *
 * An unknown placeholder is left standing rather than blanked: in a preview the
 * operator needs to see that the binding is wrong, and a silent empty string
 * would hide it until the document was already issued.
 */
export function renderPlaceholders(
  text: string,
  context: Record<string, unknown>,
  /**
   * `keep` for the builder, where a wrong binding must be visible; `blank` for
   * a real document, where the reader should see an empty cell, not syntax.
   */
  missing: 'keep' | 'blank' = 'keep',
): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (match, path: string) => {
    const value = path
      .split('.')
      .reduce<unknown>(
        (current, part) =>
          current && typeof current === 'object'
            ? (current as Record<string, unknown>)[part]
            : undefined,
        context,
      );
    if (value === undefined || value === null || value === '') return missing === 'keep' ? match : '';
    return String(value);
  });
}

/** True when a text carries at least one `{{project.field}}`-style binding. */
export function hasPlaceholder(text: string): boolean {
  return /\{\{\s*[a-zA-Z0-9_.]+\s*\}\}/.test(text);
}

/**
 * The bindings a template may use, for the builder's help text. The hierarchy
 * and team keys are open-ended — one per node type code and per job role — so
 * these are examples of each family, not the whole list.
 */
export const DOCUMENT_PLACEHOLDER_EXAMPLES: { key: string; label: string }[] = [
  { key: 'project.name', label: 'Nama project' },
  { key: 'project.code', label: 'Kode project' },
  { key: 'project.description', label: 'Deskripsi project' },
  { key: 'project.startsAt', label: 'Tanggal mulai' },
  { key: 'project.goLiveAt', label: 'Tanggal go-live' },
  { key: 'node.name', label: 'Node tempat project berada (mis. aplikasi)' },
  { key: 'hierarchy.<KODE_TIPE_NODE>.name', label: 'Leluhur menurut tipe node, mis. hierarchy.APP.name' },
  { key: 'team.<JOB_ROLE>.name', label: 'Anggota tim menurut job role, mis. team.TL.name' },
  { key: 'mandays.total', label: 'Total mandays estimasi' },
  { key: 'today', label: 'Tanggal hari ini' },
];

/** Where `to` sits relative to `from` on the grid, or null if not adjacent. */
export function edgeDirection(
  from: Pick<FlowNode, 'row' | 'col'>,
  to: Pick<FlowNode, 'row' | 'col'>,
): 'up' | 'right' | 'down' | 'left' | null {
  if (from.row === to.row && to.col === from.col + 1) return 'right';
  if (from.row === to.row && to.col === from.col - 1) return 'left';
  if (from.col === to.col && to.row === from.row + 1) return 'down';
  if (from.col === to.col && to.row === from.row - 1) return 'up';
  return null;
}
