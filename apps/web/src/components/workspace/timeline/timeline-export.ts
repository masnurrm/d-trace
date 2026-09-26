import writeXlsxFile, { type Row, type SheetData } from 'write-excel-file/browser';
import type { ProjectStage } from '@dtrace/shared';
import { STAGE_FILL, STAGE_ROW_HEX } from '../stage-palette';

/**
 * The project timeline as a real `.xlsx`: the task table on the left and the
 * Gantt drawn as filled cells on the right, one narrow column per day.
 *
 * The chart is the point of this screen, so a file carrying only the dates
 * would be the half of it nobody asked for. Cells are what a spreadsheet can
 * colour, and a bar made of cells survives being opened anywhere — an embedded
 * image would not survive a sort, a filter or a copy into somebody's own plan.
 *
 * Imported dynamically by the view, like the mandays export: a reader who never
 * downloads anything does not pay for a zip writer.
 */

export interface TimelineExportTask {
  name: string;
  startsAt: string | null;
  endsAt: string | null;
  actualStartsAt: string | null;
  actualEndsAt: string | null;
  estimatedDays: number;
  progressPercent: number;
  workDays: number;
  late: boolean;
}

export interface TimelineExportStage {
  stage: ProjectStage;
  label: string;
  startsAt: string | null;
  endsAt: string | null;
  actualStartsAt: string | null;
  actualEndsAt: string | null;
  days: number;
  progressPercent: number;
  workDays: number;
  tasks: TimelineExportTask[];
}

export interface TimelineExportDay {
  /** YYYY-MM-DD, the same key the chart on screen uses. */
  key: string;
  label: string;
  offDay: boolean;
}

export interface TimelineExportInput {
  projectName: string;
  stageLabel: string;
  startsAt: string | null;
  goLiveAt: string | null;
  overallProgress: number;
  months: { label: string; days: number }[];
  days: TimelineExportDay[];
  stages: TimelineExportStage[];
}

// The screen's colours, in the only form a spreadsheet understands.
const HEAD_FILL = '#0284c7'; // sky-600 — `bg-primary`
const HEAD_INK = '#ffffff';
const GRID = '#cbd5e1'; // slate-300
const MUTED_INK = '#64748b'; // slate-500
const OFF_DAY_FILL = '#fef2f2'; // red-50 — weekends and holidays, as on screen
const OFF_DAY_INK = '#dc2626'; // red-600
const OVERRUN_FILL = '#f87171'; // red-400 — the late tail
const LATE_INK = '#dc2626';

const RULED = { borderColor: GRID, borderStyle: 'thin' } as const;

/** Task Name, Start, End, Actual Start, Actual End, Days, % Done, Work Days. */
const TABLE_WIDTH = 8;

/** A stored datetime as the calendar day it names, or null. */
const dayKey = (iso: string | null) => (iso ? iso.slice(0, 10) : null);

/** A calendar date for Excel, pinned to UTC midnight so no timezone shifts it. */
const asDate = (iso: string | null) => {
  const key = dayKey(iso);
  if (!key) return null;
  const date = new Date(`${key}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
};

export async function exportTimeline(input: TimelineExportInput): Promise<void> {
  const width = TABLE_WIDTH + input.days.length;

  const pad = (cells: Row): Row => [
    ...cells,
    ...Array<null>(Math.max(0, width - cells.length)).fill(null),
  ];

  const info = (label: string, value: string | Date | null): Row =>
    pad([
      { value: label, textColor: MUTED_INK, fontSize: 10 },
      value instanceof Date
        ? {
            value,
            type: Date,
            format: 'dd/mm/yyyy',
            fontWeight: 'bold' as const,
            align: 'left' as const,
          }
        : { value: value ?? '—', type: String, fontWeight: 'bold' as const },
    ]);

  const dateCell = (iso: string | null, extra: Record<string, unknown> = {}) => {
    const date = asDate(iso);
    return {
      ...RULED,
      align: 'center' as const,
      ...extra,
      ...(date ? { value: date, type: Date, format: 'dd/mm/yyyy' } : {}),
    };
  };

  const numberCell = (value: number, extra: Record<string, unknown> = {}) => ({
    ...RULED,
    align: 'right' as const,
    value,
    type: Number,
    format: '0.##',
    ...extra,
  });

  const head = (value: string, extra: Record<string, unknown> = {}) => ({
    value,
    type: String,
    ...RULED,
    backgroundColor: HEAD_FILL,
    textColor: HEAD_INK,
    fontWeight: 'bold' as const,
    ...extra,
  });

  /**
   * One day column of a bar row. A day inside the planned span takes the
   * stage colour; a day past the planned end and up to the actual end is the
   * red overrun tail; everything else keeps the weekend tint of the column.
   */
  const ganttCells = (
    startsAt: string | null,
    endsAt: string | null,
    actualEndsAt: string | null,
    fill: string,
    base?: string,
  ) => {
    const from = dayKey(startsAt);
    const to = dayKey(endsAt);
    const actualTo = dayKey(actualEndsAt);

    return input.days.map((day) => {
      const inBar = from && to && day.key >= from && day.key <= to;
      const inOverrun = to && actualTo && actualTo > to && day.key > to && day.key <= actualTo;
      const backgroundColor = inBar
        ? fill
        : inOverrun
          ? OVERRUN_FILL
          : day.offDay
            ? OFF_DAY_FILL
            : base;

      return {
        borderColor: GRID,
        borderStyle: 'hair' as const,
        ...(backgroundColor ? { backgroundColor } : {}),
      };
    });
  };

  const data: SheetData = [
    pad([{ value: 'Project Timeline', type: String, fontWeight: 'bold', fontSize: 15 }]),
    pad([]),
    info('Nama Project', input.projectName),
    info('Tahapan berjalan', input.stageLabel),
    info('Start', asDate(input.startsAt)),
    info('Go Live', asDate(input.goLiveAt)),
    info('Progress keseluruhan', `${input.overallProgress}%`),
    pad([]),

    // Month band above the day numbers, spanning its own days.
    [
      ...Array.from({ length: TABLE_WIDTH }, () => ({ ...RULED, backgroundColor: HEAD_FILL })),
      ...input.months.flatMap((month) => [
        head(month.label, { columnSpan: month.days, align: 'left' as const }),
        ...Array<null>(month.days - 1).fill(null),
      ]),
    ],
    [
      head('Task Name'),
      head('Start', { align: 'center' as const }),
      head('End', { align: 'center' as const }),
      head('Actual Start', { align: 'center' as const }),
      head('Actual End', { align: 'center' as const }),
      head('Days', { align: 'center' as const }),
      head('% Done', { align: 'center' as const }),
      head('Work Days', { align: 'center' as const }),
      ...input.days.map((day) =>
        head(day.label, {
          align: 'center' as const,
          fontSize: 8,
          ...(day.offDay ? { backgroundColor: OFF_DAY_FILL, textColor: OFF_DAY_INK } : {}),
        }),
      ),
    ],

    ...input.stages.flatMap((stage): SheetData => {
      const wash = STAGE_ROW_HEX[stage.stage];
      const bold = { backgroundColor: wash, fontWeight: 'bold' as const };

      return [
        [
          { value: stage.label, type: String, ...RULED, ...bold },
          dateCell(stage.startsAt, bold),
          dateCell(stage.endsAt, bold),
          dateCell(stage.actualStartsAt, bold),
          dateCell(stage.actualEndsAt, bold),
          numberCell(stage.days, bold),
          numberCell(stage.progressPercent / 100, { ...bold, format: '0%' }),
          numberCell(stage.workDays, bold),
          // The stage's summary bar: its first start to its last end.
          ...ganttCells(stage.startsAt, stage.endsAt, null, STAGE_FILL[stage.stage], wash),
        ],
        ...stage.tasks.map((task): Row => [
          // Indented rather than space-prefixed: an indent survives a resize,
          // and a leading space breaks the moment someone sorts the sheet.
          { value: task.name, type: String, ...RULED, indent: 1 },
          dateCell(task.startsAt),
          dateCell(task.endsAt),
          dateCell(task.actualStartsAt),
          dateCell(
            task.actualEndsAt,
            task.late ? { textColor: LATE_INK, fontWeight: 'bold' as const } : {},
          ),
          numberCell(task.estimatedDays, { textColor: MUTED_INK }),
          numberCell(task.progressPercent / 100, { format: '0%' }),
          numberCell(task.workDays, { textColor: MUTED_INK }),
          ...ganttCells(task.startsAt, task.endsAt, task.actualEndsAt, STAGE_FILL[stage.stage]),
        ]),
      ];
    }),
  ];

  await writeXlsxFile(data, {
    sheet: 'Timeline',
    // Header rows stay put, and so does the task name: the chart runs far to
    // the right, and a bar with no task name beside it is a bar of nothing.
    stickyRowsCount: 10,
    stickyColumnsCount: 1,
    columns: [
      { width: 44 },
      { width: 12 },
      { width: 12 },
      { width: 12 },
      { width: 12 },
      { width: 7 },
      { width: 8 },
      { width: 10 },
      ...input.days.map(() => ({ width: 3.5 })),
    ],
  }).toFile(fileNameFor(input.projectName));
}

/** `Timeline - <project> - 2026-09-25.xlsx`, with filesystem-hostile characters removed. */
function fileNameFor(projectName: string): string {
  const safe = projectName.replace(/[\\/:*?"<>|]/g, '-').trim() || 'Project';
  const today = new Date();
  const stamp = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0'),
  ].join('-');

  return `Timeline - ${safe} - ${stamp}.xlsx`;
}
