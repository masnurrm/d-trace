import { BLOCKED, DONE, HOLD, NEUTRAL, READY, RUNNING, type Slice } from './palette';

/**
 * Stand-in data for the workspace dashboard.
 *
 * There is no Task model in the schema and no projects endpoint yet, so this
 * file is the seam where they will arrive. It is kept deliberately close to the
 * shape an API would return - a list of projects, and per project a flat set of
 * task counts - so wiring it up later is a swap of this module, not a rewrite
 * of the components that read it.
 */

export interface DashboardProject {
  id: string;
  name: string;
  code: string;
  description: string;
  /** ISO date. Mirrors `Project.goLiveAt`. */
  targetDate: string;
  /** Mirrors `Project.updatedAt`; "latest" means the newest of these. */
  updatedAt: string;
}

export interface TaskCounts {
  /** Keyed by the slice keys below. */
  dev: Record<string, number>;
  test: Record<string, number>;
  sit: Record<string, number>;
  assignees: { name: string; total: number }[];
}

/** Ordered blocked → waiting → ready → running → done; see `palette.ts`. */
export const DEV_SLICES: Slice[] = [
  { key: 'unready', label: 'Unready for Dev', color: BLOCKED },
  { key: 'waitingConfirm', label: 'Waiting confirmUser', color: HOLD },
  { key: 'ready', label: 'Ready for Dev', color: READY },
  { key: 'inProgress', label: 'InProgress Dev', color: RUNNING },
  { key: 'closed', label: 'Closed Dev', color: DONE },
];

export const TEST_SLICES: Slice[] = [
  { key: 'reopened', label: 'Re-Opened Dev', color: BLOCKED },
  { key: 'waitingDev', label: 'Waiting Development', color: NEUTRAL },
  { key: 'ready', label: 'Ready for Test', color: READY },
  { key: 'inProgress', label: 'InProgress Test', color: RUNNING },
  { key: 'closed', label: 'Closed Test', color: DONE },
];

export const SIT_SLICES: Slice[] = [
  { key: 'onHold', label: 'On Hold', color: HOLD },
  { key: 'notReady', label: 'Not Ready', color: NEUTRAL },
  { key: 'ready', label: 'Ready', color: READY },
  { key: 'inProgress', label: 'In progress', color: RUNNING },
  { key: 'complete', label: 'Complete', color: DONE },
];

export const MOCK_PROJECTS: DashboardProject[] = [
  {
    id: 'prj-portal-pelanggan',
    name: 'Portal Layanan Pelanggan',
    code: 'PLP',
    description: 'Progress task dari development, testing, sampai hasil SIT/UAT',
    targetDate: '2026-11-30',
    updatedAt: '2026-09-21T09:00:00.000Z',
  },
  {
    id: 'prj-migrasi-core',
    name: 'Migrasi Core Banking',
    code: 'MCB',
    description: 'Pemindahan modul inti ke platform baru',
    targetDate: '2027-03-31',
    updatedAt: '2026-09-18T04:30:00.000Z',
  },
  {
    id: 'prj-dashboard-internal',
    name: 'Dashboard Internal',
    code: 'DSI',
    description: 'Pelaporan operasional untuk tim internal',
    targetDate: '2026-10-15',
    updatedAt: '2026-08-02T11:15:00.000Z',
  },
];

const TASKS: Record<string, TaskCounts> = {
  'prj-portal-pelanggan': {
    dev: { unready: 4, waitingConfirm: 1, ready: 1, inProgress: 6, closed: 30 },
    test: { reopened: 3, waitingDev: 9, ready: 2, inProgress: 3, closed: 25 },
    sit: { onHold: 2, notReady: 17, ready: 6, inProgress: 7, complete: 10 },
    assignees: [
      { name: 'Rony', total: 15 },
      { name: 'Bagus', total: 8 },
      { name: 'Defran', total: 5 },
      { name: 'Fandil', total: 5 },
      { name: 'Marcel', total: 4 },
      { name: 'Nicho', total: 3 },
      { name: 'Belum ditugaskan', total: 2 },
    ],
  },
  'prj-migrasi-core': {
    dev: { unready: 9, waitingConfirm: 3, ready: 7, inProgress: 11, closed: 18 },
    test: { reopened: 2, waitingDev: 21, ready: 4, inProgress: 6, closed: 15 },
    sit: { onHold: 1, notReady: 33, ready: 5, inProgress: 4, complete: 5 },
    assignees: [
      { name: 'Defran', total: 14 },
      { name: 'Rony', total: 12 },
      { name: 'Marcel', total: 9 },
      { name: 'Bagus', total: 7 },
      { name: 'Nicho', total: 6 },
    ],
  },
  'prj-dashboard-internal': {
    dev: { unready: 0, waitingConfirm: 1, ready: 2, inProgress: 3, closed: 12 },
    test: { reopened: 1, waitingDev: 3, ready: 1, inProgress: 2, closed: 11 },
    sit: { onHold: 0, notReady: 4, ready: 2, inProgress: 3, complete: 9 },
    assignees: [
      { name: 'Fandil', total: 8 },
      { name: 'Bagus', total: 6 },
      { name: 'Rony', total: 4 },
    ],
  },
};

export function projectsByRecency(): DashboardProject[] {
  return [...MOCK_PROJECTS].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function taskCountsFor(projectId: string): TaskCounts | null {
  return TASKS[projectId] ?? null;
}

/**
 * Narrows the counts to one assignee.
 *
 * Proportional rather than real: with no task table there is nothing to filter
 * on, so each bucket keeps its shape and is scaled to that person's share. It
 * behaves like the real thing - totals move, percentages shift - without
 * pretending to know which of Rony's tasks are still in test.
 */
export function scaleToAssignee(counts: TaskCounts, assignee: string): TaskCounts {
  const person = counts.assignees.find((entry) => entry.name === assignee);
  if (!person) return counts;

  const total = counts.assignees.reduce((sum, entry) => sum + entry.total, 0);
  const share = total === 0 ? 0 : person.total / total;

  const scale = (bucket: Record<string, number>) =>
    Object.fromEntries(
      Object.entries(bucket).map(([key, value]) => [key, Math.round(value * share)]),
    );

  return {
    dev: scale(counts.dev),
    test: scale(counts.test),
    sit: scale(counts.sit),
    assignees: [person],
  };
}
