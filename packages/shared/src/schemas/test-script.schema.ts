import { z } from 'zod';

/**
 * Test scripts: the SIT and UAT scenarios a project is tested against, and
 * what happened when each one was run.
 *
 * A script is **one document per project per kind**, shaped
 * module → sub-section → scenario, and it is saved whole. That is how people
 * write one: a tester fills in a column of results top to bottom and saves,
 * and a scenario means little outside the sub-section it sits in. So the
 * structure travels as one JSON payload with the same `expectedUpdatedAt`
 * guard as every other replace-the-whole-thing form.
 *
 * SIT and UAT share every rule and every column; they differ in who runs them
 * and when, which is why they are two documents and one schema.
 */

export const TEST_SCRIPT_KINDS = ['SIT', 'UAT'] as const;
export type TestScriptKind = (typeof TEST_SCRIPT_KINDS)[number];

export const TEST_SCRIPT_KIND_LABELS: Record<TestScriptKind, string> = {
  SIT: 'System Integration Test (SIT)',
  UAT: 'User Acceptance Test (UAT)',
};

/** The URL segment under `/workspace/project/{id}/test-script/`. */
export const TEST_SCRIPT_KIND_SLUG: Record<TestScriptKind, string> = {
  SIT: 'sit',
  UAT: 'uat',
};

export function testScriptKindFromSlug(slug: string): TestScriptKind | null {
  const found = TEST_SCRIPT_KINDS.find((kind) => TEST_SCRIPT_KIND_SLUG[kind] === slug);
  return found ?? null;
}

export const TEST_TYPES = ['POSITIVE', 'NEGATIVE'] as const;
export type TestType = (typeof TEST_TYPES)[number];

export const TEST_TYPE_LABELS: Record<TestType, string> = {
  POSITIVE: 'Positif',
  NEGATIVE: 'Negatif',
};

/**
 * Pending is a real answer here, unlike a checklist's absent one: a scenario
 * that has not been run yet is exactly what a tester needs to find, and the
 * filter chips count it.
 */
export const TEST_RESULTS = ['OK', 'NOK', 'PENDING'] as const;
export type TestResult = (typeof TEST_RESULTS)[number];

export const TEST_RESULT_LABELS: Record<TestResult, string> = {
  OK: 'OK',
  NOK: 'NOK',
  PENDING: 'Pending',
};

export const TEST_ENVIRONMENTS = ['DEVELOPMENT', 'STAGING', 'UAT', 'PRODUCTION'] as const;
export type TestEnvironment = (typeof TEST_ENVIRONMENTS)[number];

export const TEST_ENVIRONMENT_LABELS: Record<TestEnvironment, string> = {
  DEVELOPMENT: 'Development',
  STAGING: 'Staging',
  UAT: 'UAT',
  PRODUCTION: 'Production',
};

export const TEST_SCRIPT_STATUSES = ['DRAFT', 'SUBMITTED'] as const;
export type TestScriptStatus = (typeof TEST_SCRIPT_STATUSES)[number];

export const TEST_SCRIPT_STATUS_LABELS: Record<TestScriptStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Tersubmit',
};

/** Screenshots per scenario — evidence, not an album. */
export const TEST_CAPTURES_PER_ROW = 5;

/* -------------------------------------------------------------------------- */
/* The payload                                                                 */
/* -------------------------------------------------------------------------- */

const text = (max: number) => z.string().trim().max(max).default('');

/**
 * One scenario, as the browser sends it.
 *
 * `id` is minted by the browser so a row keeps its identity across saves —
 * the paraf stamp is carried by it. Who initialled a row is **not** in here:
 * the API stamps it from the session, because a paraf anyone could type a
 * name into proves nothing.
 */
export const testScenarioSchema = z.object({
  id: z.uuid(),
  role: text(80),
  type: z.enum(TEST_TYPES).default('POSITIVE'),
  activity: text(1000),
  input: text(1000),
  expectedOutput: text(1000),
  result: z.enum(TEST_RESULTS).default('PENDING'),
  notes: text(1000),
  tester: text(80),
  paraf: z.boolean().default(false),
  captureIds: z.array(z.uuid()).max(TEST_CAPTURES_PER_ROW).default([]),
});

export type TestScenarioInput = z.infer<typeof testScenarioSchema>;

export interface TestSectionInput {
  id: string;
  name: string;
  rows: TestScenarioInput[];
  children: TestSectionInput[];
}

/** A section may contain scenarios directly and/or more specific descendants. */
export const testSectionSchema: z.ZodType<TestSectionInput> = z.lazy(() =>
  z.object({
    id: z.uuid(),
    name: z.string().trim().max(160).default(''),
    rows: z.array(testScenarioSchema).max(300).default([]),
    children: z.array(testSectionSchema).max(50).default([]),
  }),
);

export const testModuleSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().max(160).default(''),
  sections: z.array(testSectionSchema).max(50),
});

export type TestModuleInput = z.infer<typeof testModuleSchema>;

export const saveTestScriptSchema = z.object({
  appName: z.string().trim().max(120).default(''),
  version: z.string().trim().max(40).default(''),
  /** A calendar day, `YYYY-MM-DD`. */
  testDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Tanggal tidak valid')
    .nullable()
    .default(null),
  environment: z.enum(TEST_ENVIRONMENTS).default('STAGING'),
  modules: z.array(testModuleSchema).max(50),
  /**
   * True records the results as handed in. Refused while any scenario is still
   * Pending: a submitted script with holes in it would read as tested.
   */
  submit: z.boolean().default(false),
  /** See rule 19 in CLAUDE.md — `null` means "I loaded a script never saved". */
  expectedUpdatedAt: z.iso.datetime().nullable().optional(),
});

export type SaveTestScriptInput = z.infer<typeof saveTestScriptSchema>;

/* -------------------------------------------------------------------------- */
/* The view                                                                    */
/* -------------------------------------------------------------------------- */

export interface TestScenarioView extends TestScenarioInput {
  /** Stamped by the API from the session of whoever ticked it. */
  parafByName: string | null;
  parafAt: string | null;
}

export interface TestSectionView {
  id: string;
  name: string;
  rows: TestScenarioView[];
  children: TestSectionView[];
}

export interface TestModuleView {
  id: string;
  name: string;
  sections: TestSectionView[];
}

export interface TestCaptureView {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface TestScriptView {
  projectId: string;
  kind: TestScriptKind;
  appName: string;
  version: string;
  testDate: string | null;
  environment: TestEnvironment;
  status: TestScriptStatus;
  submittedAt: string | null;
  submittedByName: string | null;
  modules: TestModuleView[];
  /** Every capture a row points at, so the grid can name them without a lookup. */
  captures: TestCaptureView[];
  /** Null until the first save — the script is not written just by opening it. */
  updatedAt: string | null;
}

/** Sub-section letters, as the form prints them: A, B, … Z, AA, AB. */
export function sectionLetter(index: number): string {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/** The URL a browser loads a capture from, through the BFF. */
export function testCaptureUrl(captureId: string, download = false): string {
  return `/api/bff/workspace/test-captures/${captureId}${download ? '?download=1' : ''}`;
}

/* -------------------------------------------------------------------------- */
/* Totals                                                                      */
/* -------------------------------------------------------------------------- */

export interface TestScriptSummary {
  total: number;
  ok: number;
  nok: number;
  pending: number;
  /** OK over every scenario, 0-100 — a pending row counts against it. */
  passRate: number;
}

/**
 * The one definition of the counters, so the cards on screen and the summary
 * sheet in the export can never disagree.
 */
export function summarizeTestScript(
  modules: { sections: TestSummarySection[] }[],
): TestScriptSummary {
  const collect = (sections: TestSummarySection[]): { result: TestResult }[] =>
    sections.flatMap((section) => [...section.rows, ...collect(section.children ?? [])]);
  const rows = modules.flatMap((module) => collect(module.sections));
  const count = (result: TestResult) => rows.filter((row) => row.result === result).length;
  const ok = count('OK');

  return {
    total: rows.length,
    ok,
    nok: count('NOK'),
    pending: count('PENDING'),
    passRate: rows.length === 0 ? 0 : Math.round((ok / rows.length) * 100),
  };
}

interface TestSummarySection {
  rows: { result: TestResult }[];
  children?: TestSummarySection[];
}
