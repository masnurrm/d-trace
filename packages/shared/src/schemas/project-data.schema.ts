import { z } from 'zod';
import type { ProjectDataset } from './document-template.schema.js';

/**
 * What a `DATA` section holds: a snapshot of another screen's numbers.
 *
 * The API produces these from the mandays estimate and the timeline; the
 * browser only ever displays them. They are stored in the document (not read
 * live on every open) because a document is a record — a BPM approved in
 * March has to keep showing March's estimate after the plan moves on.
 *
 * Every array is bounded: this is data the server wrote, but it still travels
 * through the same save endpoint as everything else a browser sends.
 */

const roleRefSchema = z.object({
  role: z.string().max(40),
  label: z.string().max(80),
});

export const mandayActivityRowSchema = z.object({
  /** A stage banner, a parent task (a heading with a subtotal), or a leaf task. */
  kind: z.enum(['stage', 'group', 'task']),
  name: z.string().max(300),
  depth: z.number().int().min(0).max(10),
  efforts: z.record(z.string(), z.number()),
  total: z.number(),
});

export type MandayActivityRow = z.infer<typeof mandayActivityRowSchema>;

export const mandayActivityDataSchema = z.object({
  dataset: z.literal('MANDAY_ACTIVITY'),
  roles: z.array(roleRefSchema).max(10),
  rows: z.array(mandayActivityRowSchema).max(600),
  totals: z.object({ byRole: z.record(z.string(), z.number()), total: z.number() }),
});

export type MandayActivityData = z.infer<typeof mandayActivityDataSchema>;

export const mandayEffortDataSchema = z.object({
  dataset: z.literal('MANDAY_EFFORT'),
  /** The Monday of week 1, `YYYY-MM-DD`; null when nothing is scheduled. */
  startsOn: z.string().max(10).nullable(),
  weekCount: z.number().int().min(0).max(104),
  roles: z
    .array(
      roleRefSchema.extend({
        weeks: z.array(z.number()).max(104),
        total: z.number(),
      }),
    )
    .max(10),
  total: z.number(),
  /** Days on tasks the timeline has not dated yet — counted, but in no week. */
  unscheduled: z.number(),
  /** People on the project team, by job role. */
  resources: z.array(roleRefSchema.extend({ count: z.number().int().min(0) })).max(10),
});

export type MandayEffortData = z.infer<typeof mandayEffortDataSchema>;

export const projectDataSchema = z.discriminatedUnion('dataset', [
  mandayActivityDataSchema,
  mandayEffortDataSchema,
]);

export type ProjectData = z.infer<typeof projectDataSchema>;

/** Every dataset, freshly computed — what `DocumentDetail.projectData` carries. */
export type ProjectDataSet = Partial<Record<ProjectDataset, ProjectData>>;

export const EFFORT_LEVELS = ['LOW', 'MID', 'HIGH'] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

export const EFFORT_LEVEL_LABELS: Record<EffortLevel, string> = {
  LOW: 'Low (Entry)',
  MID: 'Mid (Middle)',
  HIGH: 'High (Senior/Executive)',
};

export const DEFAULT_PRICE_PER_MANDAY = 2_500_000;

const effortCustomRowSchema = z.object({
  id: z.string().min(1).max(80),
  role: z.string().trim().max(80).default(''),
  level: z.enum(EFFORT_LEVELS).default('MID'),
  weeks: z.array(z.number().min(0).max(10_000).nullable()).max(48).default([]),
  price: z.number().min(0).max(1_000_000_000).default(DEFAULT_PRICE_PER_MANDAY),
});

export const effortTableSettingsSchema = z.object({
  monthCount: z.number().int().min(1).max(12).default(3),
  levels: z.record(z.string(), z.enum(EFFORT_LEVELS)).default({}),
  /** Four manually entered week values per month; null means an empty cell. */
  weeks: z
    .record(z.string(), z.array(z.number().min(0).max(10_000).nullable()).max(48))
    .default({}),
  prices: z.record(z.string(), z.number().min(0).max(1_000_000_000)).default({}),
  customRows: z.array(effortCustomRowSchema).max(30).default([]),
});

export type EffortTableSettings = z.infer<typeof effortTableSettingsSchema>;

/**
 * The content of a `DATA` section.
 *
 * `refresh` is the author asking for the numbers to be taken again; the server
 * does the taking, so `data` from the browser is never what gets stored. A
 * malformed `data` is caught to null rather than failing the save, for the
 * same reason — it was going to be replaced anyway.
 */
export const dataContentSchema = z.object({
  capturedAt: z.string().max(40).nullable().default(null),
  refresh: z.boolean().default(false),
  data: projectDataSchema.nullable().catch(null).default(null),
  effortTable: effortTableSettingsSchema.optional(),
});

export type DataContent = z.infer<typeof dataContentSchema>;

/**
 * What `{{…}}` placeholders resolve against in a real document.
 *
 * `hierarchy` is keyed by node type code (`APP`, `COMPANY_PROJECT_DEPARTMENT`)
 * and holds every ancestor of the project's node, the node included, so a
 * template can say "the company" without knowing how deep it sits. `team` is
 * keyed by job role; `names` lists everyone in that role.
 */
export interface DocumentContext {
  project: {
    name: string;
    code: string;
    description: string;
    startsAt: string;
    goLiveAt: string;
    stage: string;
  };
  node: { name: string; code: string };
  hierarchy: Record<string, { name: string; code: string }>;
  team: Record<string, { name: string; email: string; names: string }>;
  mandays: { total: string };
  today: string;
}

/**
 * The Monday-based week grid a MANDAY_EFFORT snapshot is drawn on: week `n`
 * belongs to month `floor(n / 4) + 1` and prints as W1..W4 inside it, the
 * way the estimate spreadsheets are laid out.
 */
export function effortMonths(weekCount: number): { month: number; weeks: number }[] {
  const months: { month: number; weeks: number }[] = [];
  for (let week = 0; week < weekCount; week += 4) {
    months.push({ month: months.length + 1, weeks: Math.min(4, weekCount - week) });
  }
  return months;
}

/** A day count as the estimate prints it: `0`, `1.5`, `0.25`. */
export function formatDays(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return String(Math.round(value * 100) / 100);
}
