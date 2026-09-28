import { z } from 'zod';
import {
  CHECKLIST_RESULTS,
  hasPlaceholder,
  isPairField,
  renderPlaceholders,
  TEMPLATE_COMPONENT_TYPES,
  type TemplateComponentType,
  type TemplateSectionView,
} from './document-template.schema.js';
import {
  DOCUMENT_STATUSES,
  PROJECT_STAGES,
  type DocumentScreen,
  type DocumentStatus,
} from './workspace.schema.js';
import {
  dataContentSchema,
  type DataContent,
  type DocumentContext,
  type ProjectDataSet,
} from './project-data.schema.js';

/**
 * What a person actually types into a document.
 *
 * The master template decides the *shape* — which sections exist, which cells
 * are fixed and which are blanks. This file carries only the answers to those
 * blanks, keyed by the section's `key`. Keeping the two apart is what lets a
 * template gain a section without every existing document having to be
 * migrated: a key with no entry is simply an unanswered blank.
 *
 * It follows that nothing here repeats what the template already says. A
 * document never stores the label of an info row or the heading of a table
 * column, because those belong to the template and would otherwise be two
 * copies of one fact, free to disagree.
 */

/** A paragraph section: one body of text. */
export const textContentSchema = z.object({
  text: z.string().max(20_000).default(''),
});

/**
 * Project information: the value typed into each `INPUT` row, keyed by row id.
 *
 * A value is a string, or a pair of them for the row kinds that ask two
 * questions at once — a deployment window is a start and an end, a downtime is
 * hours and minutes. A pair rather than two rows because they are one answer:
 * splitting them would let a template drop the end date and leave the start
 * standing as if it meant something on its own.
 *
 * The union is also what keeps every document written before typed rows
 * existed readable — those are all plain strings, and still parse.
 */
export const infoValueSchema = z.union([
  z.string().max(2000),
  z.array(z.string().max(2000)).max(2),
]);

export type InfoValue = z.infer<typeof infoValueSchema>;

export const infoContentSchema = z.object({
  rows: z.record(z.string(), infoValueSchema).default({}),
});

/** Reads a pair value, whichever of the two shapes it was stored in. */
export function infoPair(value: InfoValue | undefined): [string, string] {
  if (Array.isArray(value)) return [value[0] ?? '', value[1] ?? ''];
  return [value ?? '', ''];
}

/** Reads a single value, ignoring a second half if one somehow got stored. */
export function infoSingle(value: InfoValue | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

/**
 * A table: values for the `INPUT` cells, keyed `"<rowIndex>:<columnIndex>"`,
 * plus any rows the author appended when the template allows it.
 *
 * Indices rather than ids because a template cell has no id of its own — it is
 * a position in a grid. A template that later inserts a column will shift the
 * answers, which is why `allowUserRows` and column edits are template-level
 * decisions an author is warned about rather than routine ones.
 */
export const tableContentSchema = z.object({
  cells: z.record(z.string(), z.string().max(2000)).default({}),
  extraRows: z.array(z.array(z.string().max(2000)).max(12)).max(60).default([]),
});

/** A flow: the label typed into each `INPUT` node, keyed by node id. */
export const flowContentSchema = z.object({
  nodes: z.record(z.string(), z.string().max(60)).default({}),
});

/** An approval strip: who signed each column, and when. */
export const approvalContentSchema = z.object({
  columns: z
    .record(
      z.string(),
      z.object({
        name: z.string().max(80).default(''),
        date: z.string().max(40).default(''),
      }),
    )
    .default({}),
});

/**
 * One checker's answer to one checklist item.
 *
 * `result: null` is pending, and it is the default — an item nobody has looked
 * at must not read as an item somebody cleared. The label is not here: it is
 * the template's, and a copy of it in every document would be one more pair of
 * facts free to disagree.
 */
export const checklistAnswerSchema = z.object({
  // `DONE` is the name `CLOSED` had before the list grew to four.
  result: z.preprocess(
    (value) => (value === 'DONE' ? 'CLOSED' : value),
    z.enum(CHECKLIST_RESULTS).nullable().default(null),
  ),
  remark: z.string().max(500).default(''),
  checker: z.string().max(120).default(''),
  date: z.string().max(40).default(''),
  /**
   * What was attached, as a reference — a filename, a ticket, a link. The
   * document's own file upload is a separate thing and stays that way; an
   * evidence store per checklist line is a subsystem, not a column.
   */
  evidence: z.string().max(500).default(''),
  evidenceFiles: z
    .array(
      z.object({
        id: z.uuid(),
        fileName: z.string().max(255),
        mimeType: z.string().max(100),
      }),
    )
    .max(10)
    .default([]),
});

export type ChecklistAnswer = z.infer<typeof checklistAnswerSchema>;

/** A checklist: one answer per item the template names, keyed by item id. */
export const checklistContentSchema = z.object({
  items: z.record(z.string(), checklistAnswerSchema).default({}),
  /** Per-document wording overrides; the master checklist remains unchanged. */
  itemOverrides: z
    .record(
      z.string(),
      z.object({
        domain: z.string().max(500).default(''),
        item: z.string().max(5000).default(''),
      }),
    )
    .default({}),
});

/**
 * A header is produced from the template and the project, except for the
 * blanks a line reserves with `{{input:Label}}` — keyed by `inputKey(label)`.
 */
export const headerContentSchema = z.object({
  fields: z.record(z.string().max(60), z.string().max(200)).default({}),
});

export type HeaderContent = z.infer<typeof headerContentSchema>;

export type TextContent = z.infer<typeof textContentSchema>;
export type InfoContent = z.infer<typeof infoContentSchema>;
export type TableContent = z.infer<typeof tableContentSchema>;
export type FlowContent = z.infer<typeof flowContentSchema>;
export type ApprovalContent = z.infer<typeof approvalContentSchema>;
export type ChecklistContent = z.infer<typeof checklistContentSchema>;

export type SectionContent =
  | TextContent
  | InfoContent
  | TableContent
  | FlowContent
  | ApprovalContent
  | ChecklistContent
  | HeaderContent
  | DataContent
  | Record<string, never>;

const CONTENT_SCHEMAS: Record<TemplateComponentType, z.ZodType> = {
  HEADER: headerContentSchema,
  INFO: infoContentSchema,
  TEXT: textContentSchema,
  FLOW: flowContentSchema,
  TABLE: tableContentSchema,
  APPROVAL: approvalContentSchema,
  CHECKLIST: checklistContentSchema,
  DATA: dataContentSchema,
};

/** The empty answer sheet for a component type. */
export function emptyContentFor(type: TemplateComponentType): SectionContent {
  return CONTENT_SCHEMAS[type].parse({}) as SectionContent;
}

/**
 * The whole document: `sectionKey -> content`.
 *
 * Validated loosely here and strictly per section by `parseDocumentContent`,
 * because only the template knows which schema each key belongs to — and the
 * template is not available to a plain zod schema.
 */
export const documentContentSchema = z.record(z.string(), z.unknown());
export type DocumentContent = z.infer<typeof documentContentSchema>;

/**
 * Validates a whole document against its template.
 *
 * Sections the template no longer has are dropped rather than rejected: a
 * template is allowed to change, and refusing to save a document because it
 * still carries an answer to a question that was removed would trap its author
 * with no way out.
 */
export function parseDocumentContent(
  sections: Pick<TemplateSectionView, 'key' | 'type'>[],
  raw: unknown,
): { content: DocumentContent; issues: string[] } {
  const source = (raw ?? {}) as Record<string, unknown>;
  const content: DocumentContent = {};
  const issues: string[] = [];

  for (const section of sections) {
    const schema = CONTENT_SCHEMAS[section.type];
    const parsed = schema.safeParse(source[section.key] ?? {});

    if (parsed.success) {
      content[section.key] = parsed.data;
      continue;
    }

    issues.push(`${section.key}: ${parsed.error.issues[0]?.message ?? 'isi tidak valid'}`);
    content[section.key] = emptyContentFor(section.type);
  }

  return { content, issues };
}

/* -------------------------------------------------------------------------- */
/* Saving and history                                                          */
/* -------------------------------------------------------------------------- */

export const saveDocumentContentSchema = z.object({
  content: documentContentSchema,
  /** What changed, in the author's words. Shown in the history list. */
  note: z.string().trim().max(500).nullable().default(null),
  status: z.enum(DOCUMENT_STATUSES).optional(),
  stage: z.enum(PROJECT_STAGES).optional(),
  /** The version the editor loaded; a stale save is refused, never merged. */
  expectedUpdatedAt: z.iso.datetime().optional(),
});

export type SaveDocumentContentInput = z.infer<typeof saveDocumentContentSchema>;

export const restoreDocumentVersionSchema = z.object({
  version: z.number().int().min(1),
  note: z.string().trim().max(500).nullable().default(null),
});

export type RestoreDocumentVersionInput = z.infer<typeof restoreDocumentVersionSchema>;

/** One entry in the history list. Content is fetched separately, on demand. */
export interface DocumentVersionSummary {
  id: string;
  version: number;
  note: string | null;
  status: DocumentStatus;
  /** Set when this version was produced by restoring an earlier one. */
  restoredFrom: number | null;
  createdByName: string | null;
  createdAt: string;
  /** Section keys whose content differs from the version before this one. */
  changedSections: string[];
}

export interface DocumentVersionDetail extends DocumentVersionSummary {
  content: DocumentContent;
}

/** Everything the editor needs: the template's shape and this document's answers. */
export interface DocumentDetail {
  id: string;
  title: string;
  /**
   * Set when this row stands for one of the project's screens rather than
   * holding a document of its own.
   *
   * It is on the detail, not only on the list row, because the list is not the
   * only way in: the sidebar tree links every document by id, and a bookmark
   * outlives both. The page that loads a document is the one place all of them
   * pass through, so that is where the redirect belongs.
   */
  screen: DocumentScreen | null;
  stage: (typeof PROJECT_STAGES)[number];
  status: DocumentStatus;
  ownerName: string | null;
  projectId: string;
  projectName: string;
  nodeName: string;
  breadcrumb: string;
  /** Null when the document was created blank rather than from a template. */
  template: {
    id: string;
    name: string;
    code: string;
    version: string;
    sections: TemplateSectionView[];
  } | null;
  content: DocumentContent;
  /** The number of the latest version; 0 before the first save. */
  currentVersion: number;
  capabilities: { view: boolean; edit: boolean };
  /** What `{{…}}` resolves to for this document's project. */
  context: DocumentContext;
  /**
   * Every dataset a `DATA` section can show, computed now. Shown until the
   * section has a snapshot of its own, and as the preview of a refresh.
   */
  projectData: ProjectDataSet;
  updatedAt: string;
}

/**
 * The answers as a reader should first see them.
 *
 * Two kinds of blank start filled rather than empty:
 *
 *  - an INFO `INPUT` row whose template value carries a `{{binding}}` — the
 *    company, the application, whoever leads the project. It is a suggestion,
 *    so it lands in the input where the author can overwrite it, and it is
 *    stored like any answer on the next save;
 *  - a DATA section with no snapshot yet shows the live numbers. The server
 *    takes its own snapshot on save; this only decides what is on screen.
 *
 * Applied identically by the editor and the print view, so an unsaved
 * document prints what its author is looking at.
 */
export function withDocumentDefaults(
  sections: TemplateSectionView[],
  content: DocumentContent,
  context: DocumentContext,
  projectData: ProjectDataSet,
): DocumentContent {
  const next: DocumentContent = { ...content };

  for (const section of sections) {
    if (section.type === 'INFO') {
      const current = (next[section.key] as InfoContent | undefined) ?? { rows: {} };
      const rows = { ...current.rows };
      let touched = false;

      for (const row of section.config.rows) {
        if (row.mode !== 'INPUT' || isPairField(row.field) || !hasPlaceholder(row.value)) continue;
        const answer = rows[row.id];
        if (answer !== undefined && answer !== '') continue;
        const filled = renderPlaceholders(
          row.value,
          context as unknown as Record<string, unknown>,
          'blank',
        );
        if (filled) {
          rows[row.id] = filled;
          touched = true;
        }
      }

      if (touched) next[section.key] = { ...current, rows };
    }

    if (section.type === 'DATA') {
      const current = (next[section.key] as DataContent | undefined) ?? dataContentSchema.parse({});
      if (!current.data) {
        next[section.key] = { ...current, data: projectData[section.config.dataset] ?? null };
      }
    }
  }

  return next;
}

/**
 * Images inside a rich-text body are document files served inline. This is
 * the only `src` the sanitiser lets an `<img>` keep: an image from anywhere
 * else is a request the reader's browser makes to a third party.
 */
export function documentImageUrl(fileId: string): string {
  return `/api/bff/workspace/files/${fileId}/download?inline=1`;
}

export const DOCUMENT_IMAGE_SRC_PATTERN =
  /^\/api\/bff\/workspace\/files\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/download\?inline=1$/;

/**
 * Section keys whose answers differ between two versions.
 *
 * A deep compare by serialisation: these are small plain objects produced by
 * the schemas above, so a structural difference is a textual one. It is what
 * lets the history list say *what* changed rather than only that something did.
 */
export function changedSectionKeys(
  before: DocumentContent | null,
  after: DocumentContent,
): string[] {
  if (!before) return Object.keys(after);

  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed: string[] = [];

  for (const key of keys) {
    if (stableStringify(before[key]) !== stableStringify(after[key])) changed.push(key);
  }

  return changed.sort();
}

/** Key order must not count as a difference, so keys are sorted on the way out. */
function stableStringify(value: unknown): string {
  if (value === undefined) return '';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? '';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`);

  return `{${entries.join(',')}}`;
}

/** Re-exported so a caller needs one import to talk about a document's shape. */
export { TEMPLATE_COMPONENT_TYPES };

/**
 * What a rich-text section may contain once it has been sanitised.
 *
 * Kept here, as plain data, because two different libraries enforce it: the
 * API sanitises on save, and the editor's schema decides what a person can
 * produce in the first place. A tag allowed in one and not the other would
 * silently eat somebody's formatting, so the list lives in the contract.
 *
 * `@dtrace/shared` has no runtime dependencies, so this is the allow-list and
 * not the sanitiser.
 */
export const RICH_TEXT_ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'em',
  'u',
  's',
  'h1',
  'h2',
  'h3',
  'h4',
  'ul',
  'ol',
  'li',
  'blockquote',
  'code',
  'pre',
  'hr',
  'a',
  'mark',
  'sub',
  'sup',
  'span',
  // Pictures and tables: a BPM is flow diagrams and module tables as much as
  // it is prose. Every attribute they carry is value-checked on the server.
  'img',
  'table',
  'colgroup',
  'col',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
] as const;

/**
 * Attributes, deliberately few and each one validated.
 *
 * The earlier list was empty, and that was the right default while the editor
 * offered only bold and bullets. Alignment and font size cannot be expressed
 * without an attribute, so the rule becomes: an attribute is allowed only where
 * its *values* can be checked, and `RICH_TEXT_ALLOWED_STYLES` is where that
 * checking is defined.
 *
 * `style` is here, but not as a free-text field — the sanitiser parses it and
 * keeps only the three properties below, with values matched against a pattern.
 * That is what makes it safe: the danger in `style` is `position`, `url()` and
 * sizes big enough to cover the page, and none of those can survive the filter.
 *
 * `href` is the other way in, and it is bounded by scheme rather than by
 * pattern: `RICH_TEXT_ALLOWED_SCHEMES` has no `javascript:`, so a link that
 * runs code when an approver clicks it cannot be stored.
 */
export const RICH_TEXT_ALLOWED_ATTRIBUTES: Record<string, readonly string[]> = {
  '*': ['style'],
  a: ['href', 'target', 'rel'],
  ol: ['start', 'type'],
  p: ['data-indent'],
  h1: ['data-indent'],
  h2: ['data-indent'],
  h3: ['data-indent'],
  h4: ['data-indent'],
  // `src` must match DOCUMENT_IMAGE_SRC_PATTERN; sizes and spans must be small integers.
  img: ['src', 'alt', 'width', 'height'],
  th: ['colspan', 'rowspan', 'colwidth'],
  td: ['colspan', 'rowspan', 'colwidth'],
};

/**
 * The only CSS a document body may carry, as property → permitted values.
 *
 * Font sizes are capped at two digits: `99px` is already absurd in a printed
 * document, and three would let one paragraph fill a page. Colours are hex
 * only — `rgb()` and named colours add parsing surface for no expressive gain,
 * and `url()` is never reachable this way.
 */
export const RICH_TEXT_ALLOWED_STYLES: Record<string, RegExp[]> = {
  'text-align': [/^(left|center|right|justify)$/],
  'font-size': [/^\d{1,2}px$/],
  color: [/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/],
};

/** Link schemes that cannot execute. No `javascript:`, no `data:`. */
export const RICH_TEXT_ALLOWED_SCHEMES = ['http', 'https', 'mailto'] as const;

/** The sizes the editor offers. Kept here so the menu and the filter agree. */
export const RICH_TEXT_FONT_SIZES = [10, 12, 14, 16, 18, 20, 24, 28, 32] as const;

/**
 * True when a stored value is already HTML rather than the plain text the
 * first version of this editor saved.
 *
 * Documents written before the rich-text editor hold bare text, sometimes with
 * newlines and `<` in it. Rendering that as HTML would swallow characters and
 * collapse the line breaks, so it is detected and converted instead of assumed.
 */
export function looksLikeHtml(value: string): boolean {
  return /<(p|br|h[1-4]|ul|ol|li|strong|em|u|s|blockquote|pre|code|img|table)\b[^>]*>/i.test(value);
}

/** Wraps legacy plain text into paragraphs, escaping what HTML would eat. */
export function plainTextToHtml(value: string): string {
  const escaped = value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return escaped
    .split(/\n{2,}/)
    .map((block) => `<p>${block.replace(/\n/g, '<br>')}</p>`)
    .join('');
}
