import writeXlsxFile, { type Row, type SheetData } from 'write-excel-file/browser';
import type { ProjectJobRole, ProjectStage } from '@dtrace/shared';
import { STAGE_ROW_HEX } from './stage-palette';

/**
 * The mandays grid as a real `.xlsx`.
 *
 * A spreadsheet, not a CSV: this table is read across as much as down, and the
 * thing that makes it readable — the stage bands, the outline indent, the bold
 * totals — is exactly what a comma-separated file throws away. The estimate is
 * circulated and argued over outside this app, so it has to arrive looking
 * like what was approved.
 *
 * Imported dynamically by the editor, the way the PDF annotator is: nobody who
 * only fills the table in should pay for a zip writer.
 */

type Efforts = Partial<Record<ProjectJobRole, number>>;

export interface MandayExportRow {
  /** "1.2.1" — printed in the No column, which is where an outline reads. */
  number: string;
  depth: number;
  name: string;
  /** Already rolled up: a parent carries the sum of its subtree. */
  efforts: Efforts;
  total: number;
}

export interface MandayExportStage {
  stage: ProjectStage;
  number: number;
  label: string;
  byRole: Efforts;
  total: number;
  rows: MandayExportRow[];
}

export interface MandayExportInput {
  projectName: string;
  /** ISO — the day the estimate was opened. */
  estimatedAt: string | null;
  statusLabel: string;
  roleColumns: { role: ProjectJobRole; short: string; label: string }[];
  stages: MandayExportStage[];
  grand: { byRole: Efforts; total: number };
}

// The screen's colours, in the only form a spreadsheet understands.
const HEAD_FILL = '#0284c7'; // sky-600 — `bg-primary`
const HEAD_INK = '#ffffff';
const TOTAL_FILL = '#e0f2fe'; // sky-100 — the table's own footer
const GRID = '#cbd5e1'; // slate-300
const MUTED_INK = '#64748b'; // slate-500

/** Half-days are real in an estimate; trailing zeroes are not. */
const NUMBER_FORMAT = '0.##';

const RULED = { borderColor: GRID, borderStyle: 'thin' } as const;

export async function exportMandayPlan(input: MandayExportInput): Promise<void> {
  const { roleColumns } = input;
  const width = 2 + roleColumns.length + 1;

  /** Pads a row out to the sheet's width so no row is short of cells. */
  const pad = (cells: Row): Row => [...cells, ...Array<null>(Math.max(0, width - cells.length)).fill(null)];

  /** A label/value pair above the table, each half spanning its own columns. */
  const info = (label: string, value: string | Date | null): Row => [
    { value: label, columnSpan: 2, textColor: MUTED_INK, fontSize: 10 },
    null,
    value instanceof Date
      ? { value, type: Date, format: 'dd/mm/yyyy', columnSpan: width - 2, fontWeight: 'bold' as const }
      : { value: value ?? '—', type: String, columnSpan: width - 2, fontWeight: 'bold' as const },
    ...Array<null>(width - 3).fill(null),
  ];

  /** An effort cell: blank when nothing was estimated, as on screen. */
  const effort = (value: number | undefined, fill?: string) => ({
    ...RULED,
    ...(fill ? { backgroundColor: fill } : {}),
    align: 'center' as const,
    ...(value ? { value, type: Number, format: NUMBER_FORMAT } : {}),
  });

  const estimatedAt = input.estimatedAt ? new Date(input.estimatedAt) : null;

  const data: SheetData = [
    pad([{ value: 'Create Mandays', type: String, fontWeight: 'bold', fontSize: 15, columnSpan: width }]),
    pad([]),
    info('Nama Project', input.projectName),
    info('Tanggal Estimasi', estimatedAt && !Number.isNaN(estimatedAt.getTime()) ? estimatedAt : null),
    info('Status', input.statusLabel),
    pad([]),

    // The table head, in the same sky the screen uses.
    [
      { value: 'No', type: String, ...RULED, backgroundColor: HEAD_FILL, textColor: HEAD_INK, fontWeight: 'bold', align: 'center' },
      { value: 'Task Name', type: String, ...RULED, backgroundColor: HEAD_FILL, textColor: HEAD_INK, fontWeight: 'bold' },
      ...roleColumns.map((column) => ({
        // The short code, with the full job role as the cell's own note-free
        // fallback: a column headed "BA" is only readable to people already in
        // the room, and an exported file leaves the room.
        value: column.short,
        type: String,
        ...RULED,
        backgroundColor: HEAD_FILL,
        textColor: HEAD_INK,
        fontWeight: 'bold' as const,
        align: 'center' as const,
      })),
      { value: 'Total', type: String, ...RULED, backgroundColor: HEAD_FILL, textColor: HEAD_INK, fontWeight: 'bold', align: 'center' },
    ],

    ...input.stages.flatMap((stage): SheetData => {
      const fill = STAGE_ROW_HEX[stage.stage];

      return [
        [
          { value: String(stage.number), type: String, ...RULED, backgroundColor: fill, fontWeight: 'bold', align: 'center' },
          { value: stage.label, type: String, ...RULED, backgroundColor: fill, fontWeight: 'bold' },
          ...roleColumns.map((column) => ({
            ...effort(stage.byRole[column.role], fill),
            fontWeight: 'bold' as const,
          })),
          { ...effort(stage.total, fill), fontWeight: 'bold' as const },
        ],
        ...stage.rows.map((row): Row => [
          { value: row.number, type: String, ...RULED, align: 'center', textColor: MUTED_INK, fontSize: 10 },
          // Indented rather than prefixed with spaces: Excel keeps an indent
          // when the column is resized, and a leading-space name breaks the
          // moment somebody sorts the sheet.
          { value: row.name, type: String, ...RULED, indent: row.depth },
          ...roleColumns.map((column) => effort(row.efforts[column.role])),
          { ...effort(row.total), backgroundColor: '#f8fafc' },
        ]),
      ];
    }),

    [
      { value: 'Total Mandays', type: String, ...RULED, backgroundColor: TOTAL_FILL, fontWeight: 'bold', align: 'right', columnSpan: 2 },
      null,
      ...roleColumns.map((column) => ({
        ...effort(input.grand.byRole[column.role], TOTAL_FILL),
        fontWeight: 'bold' as const,
      })),
      { ...effort(input.grand.total, TOTAL_FILL), fontWeight: 'bold' as const },
    ],
  ];

  await writeXlsxFile(data, {
    sheet: 'Mandays',
    // The head row stays put; an estimate runs past a screenful almost at once
    // and a role column with no heading is a column of anonymous numbers.
    stickyRowsCount: 7,
    columns: [
      { width: 10 },
      { width: 52 },
      ...roleColumns.map(() => ({ width: 11 })),
      { width: 12 },
    ],
  }).toFile(fileNameFor(input.projectName));
}

/**
 * `Mandays - <project> - 2026-09-25.xlsx`, with anything a filesystem refuses
 * taken out — a project name is free text and Windows rejects half a dozen
 * characters outright.
 */
function fileNameFor(projectName: string): string {
  const safe = projectName.replace(/[\\/:*?"<>|]/g, '-').trim() || 'Project';
  const today = new Date();
  const stamp = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0'),
  ].join('-');

  return `Mandays - ${safe} - ${stamp}.xlsx`;
}
