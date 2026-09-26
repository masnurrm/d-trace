import writeXlsxFile, { type Row, type SheetData } from 'write-excel-file/browser';
import {
  IMPLEMENTATION_PLAN_STATUS_LABELS,
  IMPLEMENTATION_STEP_STATUS_LABELS,
  actualStepSeconds,
  clockOfMinutes,
  formatSpan,
  scheduleImplementationPlan,
  summarizeImplementationPlan,
  type ImplementationHostView,
  type ImplementationPhaseView,
  type ImplementationPlanStatus,
  type ImplementationStepStatus,
} from '@dtrace/shared';

/**
 * The implementation plan as a real `.xlsx`, laid out the way it is on screen:
 * the identity block on top, then one table with the phases as bands, the
 * estimate and the actual side by side, and the two totals underneath.
 *
 * The estimated schedule and the totals come from the same shared functions
 * the screen uses, so the file can never disagree with the page it was
 * exported from. Imported dynamically by the editor, like the other exports:
 * a reader who never downloads anything does not pay for a zip writer.
 */

export interface ImplementationPlanExportInput {
  projectName: string;
  serviceName: string;
  implementationDate: string | null;
  startTime: string;
  hosts: ImplementationHostView[];
  phases: ImplementationPhaseView[];
  status: ImplementationPlanStatus;
  completedAt: string | null;
  completedByName: string | null;
  /** The reader's zone, so actual times read as the clock they were taken by. */
  timeZone: string | undefined;
}

// The screen's colours, in the only form a spreadsheet understands.
const HEAD_FILL = '#0284c7'; // sky-600 — `bg-primary`
const HEAD_INK = '#ffffff';
const PHASE_FILL = '#e0f2fe'; // sky-100
const PHASE_INK = '#075985'; // sky-800
const TOTAL_FILL = '#f1f5f9'; // slate-100
const GRID = '#cbd5e1'; // slate-300
const MUTED_INK = '#64748b'; // slate-500
const DOWN_FILL = '#fee2e2'; // red-100
const DOWN_INK = '#b91c1c'; // red-700

const STATUS_FILL: Record<ImplementationStepStatus, string> = {
  NOT_STARTED: '#f1f5f9',
  IN_PROGRESS: '#fef3c7',
  DONE: '#d1fae5',
  FAILED: '#fee2e2',
  SKIPPED: '#e2e8f0',
};
const STATUS_INK: Record<ImplementationStepStatus, string> = {
  NOT_STARTED: '#475569',
  IN_PROGRESS: '#92400e',
  DONE: '#047857',
  FAILED: '#b91c1c',
  SKIPPED: '#64748b',
};

const RULED = { borderColor: GRID, borderStyle: 'thin' } as const;

/** No, Activity, Host, Downtime, PIC, 3 × Estimate, 3 × Actual, Status, Note. */
const WIDTH = 13;

const pad = (cells: Row): Row => [...cells, ...Array<null>(Math.max(0, WIDTH - cells.length)).fill(null)];

/** A calendar day, read in UTC — it is a day somebody picked, stored as midnight. */
function formatDay(day: string | null): string {
  if (!day) return '—';
  const date = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return day;
  return date.toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Minutes after the start of the day as `HH:MM`, with `(+1)` on the next day. */
function estimateClock(minutes: number): string {
  const { time, dayOffset } = clockOfMinutes(minutes);
  return dayOffset > 0 ? `${time} (+${dayOffset})` : time;
}

export async function exportImplementationPlan(input: ImplementationPlanExportInput): Promise<void> {
  const clock = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZone: input.timeZone ?? 'UTC',
  });
  const actualClock = (iso: string | null) => (iso ? clock.format(new Date(iso)) : '–');

  const schedule = scheduleImplementationPlan(input.startTime, input.phases);
  const summary = summarizeImplementationPlan(input.phases);

  const info = (label: string, value: string): Row =>
    pad([
      { value: label, type: String, textColor: MUTED_INK, fontSize: 10 },
      { value: value || '—', type: String, fontWeight: 'bold', columnSpan: 4 },
    ]);

  const head = (value: string | null, extra: Record<string, unknown> = {}) => ({
    ...RULED,
    ...(value !== null ? { value, type: String } : {}),
    backgroundColor: HEAD_FILL,
    textColor: HEAD_INK,
    fontWeight: 'bold' as const,
    alignVertical: 'center' as const,
    ...extra,
  });

  const text = (value: string, extra: Record<string, unknown> = {}) => ({
    ...RULED,
    value,
    type: String,
    alignVertical: 'top' as const,
    ...extra,
  });

  const status =
    input.status === 'COMPLETED'
      ? `${IMPLEMENTATION_PLAN_STATUS_LABELS.COMPLETED} — ${input.completedByName ?? '—'}${
          input.completedAt
            ? `, ${new Date(input.completedAt).toLocaleString('id-ID', {
                dateStyle: 'medium',
                timeStyle: 'short',
                timeZone: input.timeZone ?? 'UTC',
              })}`
            : ''
        }`
      : IMPLEMENTATION_PLAN_STATUS_LABELS[input.status];

  let number = 0;

  const data: SheetData = [
    pad([{ value: 'Implementation Plan', type: String, fontWeight: 'bold', fontSize: 15 }]),
    pad([]),
    info('Nama Project', input.projectName),
    info('Service Name', input.serviceName),
    info('Tanggal Implementasi', formatDay(input.implementationDate)),
    info('Jam Mulai (Estimasi)', input.startTime),
    ...input.hosts.map((host) => info(host.label || 'Host', host.address)),
    info('Status', status),
    info('Progres', `${summary.settled}/${summary.total} (${summary.progressPercent}%)`),
    info('Estimasi selesai', estimateClock(schedule.end)),
    pad([]),

    [
      head('No', { rowSpan: 2, align: 'center' }),
      head('Activity', { rowSpan: 2 }),
      head('Hostname / IP', { rowSpan: 2 }),
      head('Downtime', { rowSpan: 2, align: 'center' }),
      head('PIC', { rowSpan: 2 }),
      head('Estimate', { columnSpan: 3, align: 'center' }),
      null,
      null,
      head('Actual', { columnSpan: 3, align: 'center' }),
      null,
      null,
      head('Status', { rowSpan: 2, align: 'center' }),
      head('Note', { rowSpan: 2 }),
    ],
    [
      head(null),
      head(null),
      head(null),
      head(null),
      head(null),
      head('Start', { align: 'center' }),
      head('Durasi (mnt)', { align: 'center' }),
      head('End', { align: 'center' }),
      head('Start', { align: 'center' }),
      head('Duration', { align: 'center' }),
      head('End', { align: 'center' }),
      head(null),
      head(null),
    ],

    ...input.phases.flatMap((phase): SheetData => [
      pad([
        {
          value: phase.name || 'Fase tanpa nama',
          type: String,
          ...RULED,
          columnSpan: WIDTH,
          backgroundColor: PHASE_FILL,
          textColor: PHASE_INK,
          fontWeight: 'bold',
        },
      ]),
      ...phase.steps.map((step): Row => {
        number += 1;
        const estimate = schedule.steps[step.id] ?? { start: 0, end: 0 };
        const actual = actualStepSeconds(step);
        return [
          { ...RULED, value: number, type: Number, align: 'center', alignVertical: 'top' },
          text(step.activity, { wrap: true }),
          text(step.host, { wrap: true }),
          text(
            step.downtime ? 'Yes' : 'No',
            step.downtime
              ? { align: 'center', backgroundColor: DOWN_FILL, textColor: DOWN_INK, fontWeight: 'bold' }
              : { align: 'center', textColor: MUTED_INK },
          ),
          text(step.pic),
          text(estimateClock(estimate.start), { align: 'center' }),
          { ...RULED, value: step.durationMinutes, type: Number, align: 'center', alignVertical: 'top' },
          text(estimateClock(estimate.end), { align: 'center' }),
          text(actualClock(step.actualStartedAt), { align: 'center' }),
          text(actual !== null ? formatSpan(actual) : '–', { align: 'center' }),
          text(actualClock(step.actualFinishedAt), { align: 'center' }),
          text(IMPLEMENTATION_STEP_STATUS_LABELS[step.status], {
            align: 'center',
            backgroundColor: STATUS_FILL[step.status],
            textColor: STATUS_INK[step.status],
            fontWeight: 'bold',
          }),
          text(step.note, { wrap: true }),
        ];
      }),
    ]),

    ...[
      ['Total Duration', summary.estimatedMinutes * 60, summary.actualSeconds],
      ['Total Downtime Duration', summary.estimatedDowntimeMinutes * 60, summary.actualDowntimeSeconds],
    ].map(([label, estimated, actual]): Row => {
      const bold = { ...RULED, backgroundColor: TOTAL_FILL, fontWeight: 'bold' as const };
      return [
        { ...bold, value: label as string, type: String, columnSpan: 5 },
        null,
        null,
        null,
        null,
        { ...bold },
        { ...bold, value: formatSpan(estimated as number), type: String, align: 'center' },
        { ...bold },
        { ...bold },
        { ...bold, value: formatSpan(actual as number), type: String, align: 'center' },
        { ...bold },
        { ...bold },
        { ...bold },
      ];
    }),
  ];

  await writeXlsxFile(data, {
    sheet: 'Implementation Plan',
    columns: [
      { width: 5 },
      { width: 48 },
      { width: 22 },
      { width: 10 },
      { width: 12 },
      { width: 11 },
      { width: 12 },
      { width: 11 },
      { width: 11 },
      { width: 11 },
      { width: 11 },
      { width: 13 },
      { width: 32 },
    ],
  }).toFile(fileNameFor(input.projectName));
}

/** `Implementation Plan - <project> - 2026-09-25.xlsx`, with filesystem-hostile characters removed. */
function fileNameFor(projectName: string): string {
  const safe = projectName.replace(/[\\/:*?"<>|]/g, '-').trim() || 'Project';
  const today = new Date();
  const stamp = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0'),
  ].join('-');

  return `Implementation Plan - ${safe} - ${stamp}.xlsx`;
}
