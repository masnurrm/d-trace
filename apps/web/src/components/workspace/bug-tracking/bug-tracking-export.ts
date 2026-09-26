import writeXlsxFile, { type Row, type SheetData } from 'write-excel-file/browser';
import {
  BUG_ENVIRONMENT_LABELS,
  BUG_SEVERITY_LABELS,
  BUG_STATUS_LABELS,
  type BugEnvironment,
  type BugSeverity,
  type BugStatus,
  type BugView,
} from '@dtrace/shared';
import { dayIn, instantDay, isOverdue, storedDay } from './bug-style';

/**
 * The Bug & Issue list as a real `.xlsx`: one row per bug, in the order the
 * screen numbers them, with the filters in force written above the table so a
 * file passed around says which slice of the project it is.
 *
 * Imported dynamically by the board, like the other exports: a reader who never
 * downloads anything does not pay for a zip writer.
 */

export interface BugExportContext {
  projectName: string;
  /** "Label: value" for each filter in force. */
  filters: string[];
  /** The reader's zone, so a handover or a resolution lands on the day they saw it. */
  timeZone: string | undefined;
}

// The screen's colours, in the only form a spreadsheet understands.
const HEAD_FILL = '#0284c7'; // sky-600 — `bg-primary`
const HEAD_INK = '#ffffff';
const GRID = '#cbd5e1'; // slate-300
const MUTED_INK = '#64748b'; // slate-500
const LATE_INK = '#dc2626'; // red-600

const STATUS_FILL: Record<BugStatus, string> = {
  OPEN: '#f1f5f9',
  IN_PROGRESS: '#dbeafe',
  PENDING_TEST: '#fef3c7',
  IN_QA: '#ede9fe',
  DONE: '#d1fae5',
};

const SEVERITY_FILL: Record<BugSeverity, string> = {
  HIGH: '#fee2e2',
  MEDIUM: '#fef3c7',
  LOW: '#d1fae5',
};

const ENVIRONMENT_FILL: Record<BugEnvironment, string> = {
  SIT: '#e0f2fe',
  UAT: '#e0e7ff',
  PROD: '#fee2e2',
};

const RULED = { borderColor: GRID, borderStyle: 'thin' } as const;

const HEADINGS = [
  'No',
  'Bug ID',
  'Environment',
  'Judul',
  'Deskripsi',
  'Modul',
  'Severity',
  'Status',
  'Developer',
  'QA PIC',
  'Ditemukan',
  'Fix ETA',
  'Diserahkan ke QA',
  'Selesai',
  'Dilaporkan oleh',
] as const;

const pad = (cells: Row): Row => [
  ...cells,
  ...Array<null>(Math.max(0, HEADINGS.length - cells.length)).fill(null),
];

/** A day as an Excel date at UTC midnight, so it lands on the same day everywhere. */
const excelDay = (day: string): Date => new Date(`${day}T00:00:00.000Z`);

export async function exportBugsToExcel(bugs: BugView[], context: BugExportContext): Promise<void> {
  const { timeZone } = context;
  const today = dayIn(new Date(), timeZone);

  const text = (value: string | null, extra: Record<string, unknown> = {}) => ({
    ...RULED,
    value: value ?? '—',
    type: String,
    alignVertical: 'top' as const,
    ...extra,
  });

  const date = (day: string | null, extra: Record<string, unknown> = {}) => ({
    ...RULED,
    alignVertical: 'top' as const,
    ...(day ? { value: excelDay(day), type: Date, format: 'dd/mm/yyyy' } : {}),
    ...extra,
  });

  const info = (label: string, value: string): Row =>
    pad([
      { value: label, type: String, textColor: MUTED_INK, fontSize: 10 },
      { value, type: String, fontWeight: 'bold', columnSpan: 4 },
    ]);

  const data: SheetData = [
    pad([{ value: 'Bug & Issue List', type: String, fontWeight: 'bold', fontSize: 15 }]),
    pad([]),
    info('Project', context.projectName),
    info('Filter', context.filters.length > 0 ? context.filters.join(' · ') : 'Semua bug'),
    info('Jumlah bug', String(bugs.length)),
    info('Diekspor', new Date().toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone })),
    pad([]),
    HEADINGS.map((heading) => ({
      ...RULED,
      value: heading,
      type: String,
      backgroundColor: HEAD_FILL,
      textColor: HEAD_INK,
      fontWeight: 'bold' as const,
    })),
    ...bugs.map((bug, index): Row => {
      const late = isOverdue(bug, today);
      return [
        { ...RULED, value: index + 1, type: Number, align: 'center', alignVertical: 'top' },
        text(bug.code, { fontWeight: 'bold' }),
        text(BUG_ENVIRONMENT_LABELS[bug.environment], {
          backgroundColor: ENVIRONMENT_FILL[bug.environment],
        }),
        text(bug.title, { wrap: true }),
        text(bug.description, { wrap: true }),
        text(bug.module),
        text(BUG_SEVERITY_LABELS[bug.severity], { backgroundColor: SEVERITY_FILL[bug.severity] }),
        text(BUG_STATUS_LABELS[bug.status], { backgroundColor: STATUS_FILL[bug.status] }),
        text(bug.developerName),
        text(bug.qaName),
        date(storedDay(bug.foundAt)),
        date(bug.fixEta ? storedDay(bug.fixEta) : null, late ? { textColor: LATE_INK, fontWeight: 'bold' } : {}),
        date(bug.readyForTestAt ? instantDay(bug.readyForTestAt, timeZone) : null),
        date(bug.resolvedAt ? instantDay(bug.resolvedAt, timeZone) : null),
        text(bug.reportedByName),
      ];
    }),
  ];

  await writeXlsxFile(data, {
    sheet: 'Bug & Issue',
    columns: [
      { width: 5 },
      { width: 11 },
      { width: 13 },
      { width: 40 },
      { width: 48 },
      { width: 18 },
      { width: 10 },
      { width: 16 },
      { width: 20 },
      { width: 20 },
      { width: 12 },
      { width: 12 },
      { width: 16 },
      { width: 12 },
      { width: 20 },
    ],
  }).toFile(fileNameFor(context.projectName, today));
}

/** `Bug & Issue - <project> - 2026-09-25.xlsx`, with filesystem-hostile characters removed. */
function fileNameFor(projectName: string, today: string): string {
  const safe = projectName.replace(/[\\/:*?"<>|]/g, '-').trim() || 'Project';
  return `Bug & Issue - ${safe} - ${today}.xlsx`;
}
