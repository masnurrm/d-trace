/**
 * Field-level differences between two versions of a row.
 *
 * Lives in the contract package because the API computes it on write and the
 * web app renders it on read: if the two disagreed about what "changed" means,
 * the trail would show one thing and hold another.
 */

/** Columns that change on every write and say nothing about intent. */
export const DIFF_IGNORED_FIELDS = ['updatedAt', 'createdAt'] as const;

export type FieldValues = Record<string, unknown>;

export interface RecordDiff {
  /** Only the fields that differ. Null for an insert. */
  before: FieldValues | null;
  /** Only the fields that differ. Null for a delete. */
  after: FieldValues | null;
}

/**
 * How a single field changed, which is what decides its colour.
 *
 * `added` covers both an insert and a field that went from nothing to
 * something; `removed` covers a delete and a field that was cleared.
 */
export type FieldChangeKind = 'added' | 'updated' | 'removed';

export interface FieldChange {
  field: string;
  kind: FieldChangeKind;
  before: unknown;
  after: unknown;
}

const isEmpty = (value: unknown) => value === null || value === undefined || value === '';

/** Structural equality, good enough for JSON-shaped column values. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Narrows two row snapshots to the fields that actually differ.
 *
 * An update stores only what moved - a document template holds a whole section
 * tree, and keeping a full copy of it on every edit would make the trail far
 * larger than the table it describes. An insert keeps the whole new row, a
 * delete the whole old one, because there is nothing to compare against.
 */
export function diffRecords(
  before: FieldValues | null | undefined,
  after: FieldValues | null | undefined,
  ignore: readonly string[] = DIFF_IGNORED_FIELDS,
): RecordDiff {
  const skip = new Set(ignore);

  if (!before && !after) return { before: null, after: null };
  if (!before) return { before: null, after: after ?? null };
  if (!after) return { before, after: null };

  const changedBefore: FieldValues = {};
  const changedAfter: FieldValues = {};

  // Intersection, not union: if one side was selected with a narrower
  // projection than the other, the missing columns are unknown, not changed.
  // Two snapshots of the same table have the same keys anyway.
  for (const field of Object.keys(after).filter((key) => key in before)) {
    if (skip.has(field)) continue;
    if (sameValue(before[field], after[field])) continue;

    changedBefore[field] = before[field] ?? null;
    changedAfter[field] = after[field] ?? null;
  }

  // Nothing moved: the caller asked for an update that was a no-op.
  if (Object.keys(changedAfter).length === 0) return { before: null, after: null };

  return { before: changedBefore, after: changedAfter };
}

/**
 * Flattens a stored diff into the list the detail view renders, one row per
 * field, sorted so the reader always finds a field in the same place.
 */
export function toFieldChanges(diff: RecordDiff): FieldChange[] {
  const { before, after } = diff;
  if (!before && !after) return [];

  const fields = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);

  return [...fields]
    .sort((a, b) => a.localeCompare(b))
    .map((field) => {
      const from = before?.[field];
      const to = after?.[field];

      const kind: FieldChangeKind =
        !before || isEmpty(from) ? 'added' : !after || isEmpty(to) ? 'removed' : 'updated';

      return { field, kind, before: from ?? null, after: to ?? null };
    });
}
