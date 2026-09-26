import {
  DEV_STATUSES,
  DEV_STATUS_LABELS,
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TEST_STATUSES,
  TEST_STATUS_LABELS,
  isTaskComplete,
  isTaskNotStarted,
  type DevStatus,
  type ProjectTaskView,
  type TaskPriority,
  type TestStatus,
} from '@dtrace/shared';
import type { Cell, Fill, Worksheet } from 'exceljs';

/**
 * Task Activity as an Excel workbook.
 *
 * A real .xlsx rather than a CSV, so it opens with the things a reader would
 * otherwise have to add by hand: auto-filter on every column, a frozen header,
 * dates Excel sorts and filters as dates, percentages as numbers, and the same
 * status colours the screen uses.
 *
 * exceljs is loaded on click, not with the page — it is several hundred kB and
 * most visits to this screen never export.
 */

export interface TaskExportContext {
  projectName: string;
  /** The filters in force, as "Label: value" — written above the table so a
   *  file passed around says which slice of the project it is. */
  filters: string[];
}

const DEV_FILL: Record<DevStatus, string> = {
  UNREADY: 'F1F5F9',
  WAITING_CONFIRM_USER: 'FEF3C7',
  READY: 'DBEAFE',
  IN_PROGRESS: 'EDE9FE',
  CLOSED: 'D1FAE5',
};

const TEST_FILL: Record<TestStatus, string> = {
  REOPENED: 'FEF3C7',
  WAITING_DEVELOPMENT: 'F1F5F9',
  READY: 'DBEAFE',
  IN_PROGRESS: 'EDE9FE',
  CLOSED: 'D1FAE5',
};

const PRIORITY_FILL: Record<TaskPriority, string> = {
  HIGH: 'FEE2E2',
  MEDIUM: 'FEF3C7',
  LOW: 'DBEAFE',
};

const HEADER_FILL = '0284C7';
const DEV_GROUP_FILL = 'E0F2FE';
const TEST_GROUP_FILL = 'DCFCE7';
const LATE_FONT = 'DC2626';
const BORDER = 'E2E8F0';

const DATE_FORMAT = 'dd-mmm-yyyy';

const solid = (argb: string): Fill => ({
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: `FF${argb}` },
});

/**
 * A stored day as an Excel date.
 *
 * Built from the YYYY-MM-DD part at UTC midnight: exceljs writes a Date as a
 * UTC serial, and going through local time would move every date by a day for
 * anyone west of Greenwich.
 */
function toExcelDate(iso: string | null): Date | null {
  if (!iso) return null;
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

/** Finished after the planned end — compared by day, like the Timeline. */
function isLate(planEnd: string | null, actualEnd: string | null): boolean {
  return Boolean(planEnd && actualEnd && actualEnd.slice(0, 10) > planEnd.slice(0, 10));
}

interface Column {
  header: string;
  key: string;
  width: number;
  group: 'task' | 'dev' | 'test' | 'other';
  kind?: 'date' | 'percent' | 'number' | 'wrap';
}

const COLUMNS: Column[] = [
  { header: 'No', key: 'no', width: 6, group: 'task', kind: 'number' },
  { header: 'Modul', key: 'module', width: 22, group: 'task' },
  { header: 'Category', key: 'category', width: 16, group: 'task' },
  { header: 'Task Description', key: 'description', width: 44, group: 'task', kind: 'wrap' },
  { header: 'Priority', key: 'priority', width: 11, group: 'task' },
  { header: 'Assigned to', key: 'assignee', width: 22, group: 'task' },

  { header: 'Plan Start', key: 'devPlanStart', width: 13, group: 'dev', kind: 'date' },
  { header: 'Plan End', key: 'devPlanEnd', width: 13, group: 'dev', kind: 'date' },
  { header: 'Actual Start', key: 'devActualStart', width: 13, group: 'dev', kind: 'date' },
  { header: 'Actual End', key: 'devActualEnd', width: 13, group: 'dev', kind: 'date' },
  { header: '% Done', key: 'devCompletion', width: 9, group: 'dev', kind: 'percent' },
  { header: 'Status', key: 'devStatus', width: 24, group: 'dev' },
  { header: 'Terlambat', key: 'devLate', width: 11, group: 'dev' },

  { header: 'Plan Start', key: 'testPlanStart', width: 13, group: 'test', kind: 'date' },
  { header: 'Plan End', key: 'testPlanEnd', width: 13, group: 'test', kind: 'date' },
  { header: 'Actual Start', key: 'testActualStart', width: 13, group: 'test', kind: 'date' },
  { header: 'Actual End', key: 'testActualEnd', width: 13, group: 'test', kind: 'date' },
  { header: '% Done', key: 'testCompletion', width: 9, group: 'test', kind: 'percent' },
  { header: 'Status', key: 'testStatus', width: 24, group: 'test' },
  { header: 'Terlambat', key: 'testLate', width: 11, group: 'test' },

  { header: 'Remark Dev/Test', key: 'remark', width: 36, group: 'other', kind: 'wrap' },
  { header: 'Terakhir diubah', key: 'updatedAt', width: 18, group: 'other' },
];

const GROUP_LABEL: Record<Column['group'], string> = {
  task: 'Task',
  dev: 'Development',
  test: 'Testing',
  other: '',
};

/** Rows above the table: title, export line, filter line, a gap. */
const TITLE_ROWS = 4;
const GROUP_ROW = TITLE_ROWS + 1;
const HEADER_ROW = TITLE_ROWS + 2;

function taskSheet(sheet: Worksheet, tasks: ProjectTaskView[], context: TaskExportContext) {
  sheet.columns = COLUMNS.map((column) => ({ key: column.key, width: column.width }));
  const lastColumn = COLUMNS.length;

  sheet.getCell(1, 1).value = `Task Activity — ${context.projectName}`;
  sheet.getCell(1, 1).font = { bold: true, size: 14 };
  sheet.getCell(2, 1).value =
    `Diekspor ${new Date().toLocaleString('id-ID', { dateStyle: 'long', timeStyle: 'short' })} · ${tasks.length} task`;
  sheet.getCell(2, 1).font = { color: { argb: 'FF64748B' } };
  sheet.getCell(3, 1).value =
    context.filters.length > 0 ? `Filter: ${context.filters.join(' · ')}` : 'Filter: semua task';
  sheet.getCell(3, 1).font = { italic: true, color: { argb: 'FF64748B' } };

  // Group band above the headers, merged per half, as on the screen.
  let start = 0;
  while (start < COLUMNS.length) {
    const group = COLUMNS[start]!.group;
    let end = start;
    while (end + 1 < COLUMNS.length && COLUMNS[end + 1]!.group === group) end += 1;

    if (end > start) sheet.mergeCells(GROUP_ROW, start + 1, GROUP_ROW, end + 1);
    const cell = sheet.getCell(GROUP_ROW, start + 1);
    cell.value = GROUP_LABEL[group];
    cell.font = { bold: true, color: { argb: 'FF0F172A' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    const fill = group === 'dev' ? DEV_GROUP_FILL : group === 'test' ? TEST_GROUP_FILL : 'F8FAFC';
    for (let column = start + 1; column <= end + 1; column += 1) {
      sheet.getCell(GROUP_ROW, column).fill = solid(fill);
    }
    start = end + 1;
  }

  const header = sheet.getRow(HEADER_ROW);
  COLUMNS.forEach((column, index) => {
    const cell = header.getCell(index + 1);
    cell.value = column.header;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = solid(HEADER_FILL);
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
  header.height = 22;

  tasks.forEach((task, index) => {
    const devLate = isLate(task.devPlanEnd, task.devActualEnd);
    const testLate = isLate(task.testPlanEnd, task.testActualEnd);

    const row = sheet.addRow({
      no: index + 1,
      module: task.module,
      category: task.category ?? '',
      description: task.description,
      priority: TASK_PRIORITY_LABELS[task.priority],
      assignee: task.assigneeName ?? '',
      devPlanStart: toExcelDate(task.devPlanStart),
      devPlanEnd: toExcelDate(task.devPlanEnd),
      devActualStart: toExcelDate(task.devActualStart),
      devActualEnd: toExcelDate(task.devActualEnd),
      devCompletion: task.devCompletion / 100,
      devStatus: DEV_STATUS_LABELS[task.devStatus],
      devLate: devLate ? 'Ya' : 'Tidak',
      testPlanStart: toExcelDate(task.testPlanStart),
      testPlanEnd: toExcelDate(task.testPlanEnd),
      testActualStart: toExcelDate(task.testActualStart),
      testActualEnd: toExcelDate(task.testActualEnd),
      testCompletion: task.testCompletion / 100,
      testStatus: TEST_STATUS_LABELS[task.testStatus],
      testLate: testLate ? 'Ya' : 'Tidak',
      remark: task.remark ?? '',
      updatedAt: new Date(task.updatedAt).toLocaleString('id-ID', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
    });

    COLUMNS.forEach((column, columnIndex) => {
      const cell = row.getCell(columnIndex + 1);
      cell.alignment = {
        vertical: 'top',
        wrapText: column.kind === 'wrap',
        horizontal: column.kind === 'percent' || column.kind === 'number' ? 'right' : undefined,
      };
      if (column.kind === 'date') cell.numFmt = DATE_FORMAT;
      if (column.kind === 'percent') cell.numFmt = '0%';
    });

    const cellOf = (key: string): Cell => row.getCell(COLUMNS.findIndex((c) => c.key === key) + 1);
    cellOf('priority').fill = solid(PRIORITY_FILL[task.priority]);
    cellOf('devStatus').fill = solid(DEV_FILL[task.devStatus]);
    cellOf('testStatus').fill = solid(TEST_FILL[task.testStatus]);
    if (devLate) {
      cellOf('devActualEnd').font = { bold: true, color: { argb: `FF${LATE_FONT}` } };
      cellOf('devLate').font = { bold: true, color: { argb: `FF${LATE_FONT}` } };
    }
    if (testLate) {
      cellOf('testActualEnd').font = { bold: true, color: { argb: `FF${LATE_FONT}` } };
      cellOf('testLate').font = { bold: true, color: { argb: `FF${LATE_FONT}` } };
    }
  });

  // Thin grid over the table only, so the title rows stay clean.
  const lastRow = HEADER_ROW + tasks.length;
  for (let r = GROUP_ROW; r <= lastRow; r += 1) {
    for (let c = 1; c <= lastColumn; c += 1) {
      const edge = { style: 'thin' as const, color: { argb: `FF${BORDER}` } };
      sheet.getCell(r, c).border = { top: edge, left: edge, bottom: edge, right: edge };
    }
  }

  // The filter sits on the header row and covers every task row beneath it.
  sheet.autoFilter = {
    from: { row: HEADER_ROW, column: 1 },
    to: { row: Math.max(lastRow, HEADER_ROW), column: lastColumn },
  };

  // Header and the first four columns stay put while scrolling, so a date
  // far to the right can still be read against the task it belongs to.
  sheet.views = [{ state: 'frozen', xSplit: 4, ySplit: HEADER_ROW }];
}

function summarySheet(sheet: Worksheet, tasks: ProjectTaskView[], context: TaskExportContext) {
  sheet.columns = [{ width: 32 }, { width: 12 }, { width: 12 }];

  sheet.getCell('A1').value = `Ringkasan — ${context.projectName}`;
  sheet.getCell('A1').font = { bold: true, size: 14 };

  const average = (values: number[]) =>
    values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length / 100;

  let row = 3;
  const section = (title: string) => {
    const cell = sheet.getCell(row, 1);
    cell.value = title;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    for (let c = 1; c <= 3; c += 1) sheet.getCell(row, c).fill = solid(HEADER_FILL);
    sheet.getCell(row, 2).value = 'Jumlah';
    sheet.getCell(row, 2).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getCell(row, 3).value = '%';
    sheet.getCell(row, 3).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    row += 1;
  };
  const line = (label: string, count: number, fill?: string) => {
    sheet.getCell(row, 1).value = label;
    sheet.getCell(row, 2).value = count;
    sheet.getCell(row, 3).value = tasks.length === 0 ? 0 : count / tasks.length;
    sheet.getCell(row, 3).numFmt = '0%';
    if (fill) sheet.getCell(row, 1).fill = solid(fill);
    row += 1;
  };
  const valueLine = (label: string, value: number, format?: string) => {
    sheet.getCell(row, 1).value = label;
    sheet.getCell(row, 2).value = value;
    if (format) sheet.getCell(row, 2).numFmt = format;
    row += 1;
  };

  section('Umum');
  line('Total task', tasks.length);
  line('Selesai (Closed dev & test)', tasks.filter(isTaskComplete).length);
  line('Belum mulai', tasks.filter(isTaskNotStarted).length);
  line('Dev terlambat', tasks.filter((t) => isLate(t.devPlanEnd, t.devActualEnd)).length);
  line('Test terlambat', tasks.filter((t) => isLate(t.testPlanEnd, t.testActualEnd)).length);
  valueLine('Rata-rata % dev', average(tasks.map((t) => t.devCompletion)), '0%');
  valueLine('Rata-rata % test', average(tasks.map((t) => t.testCompletion)), '0%');
  row += 1;

  section('Priority');
  for (const priority of TASK_PRIORITIES) {
    line(TASK_PRIORITY_LABELS[priority], tasks.filter((t) => t.priority === priority).length, PRIORITY_FILL[priority]);
  }
  row += 1;

  section('Status Development');
  for (const status of DEV_STATUSES) {
    line(DEV_STATUS_LABELS[status], tasks.filter((t) => t.devStatus === status).length, DEV_FILL[status]);
  }
  row += 1;

  section('Status Testing');
  for (const status of TEST_STATUSES) {
    line(TEST_STATUS_LABELS[status], tasks.filter((t) => t.testStatus === status).length, TEST_FILL[status]);
  }
  row += 1;

  section('Assignee');
  const byAssignee = new Map<string, number>();
  for (const task of tasks) {
    const name = task.assigneeName ?? '(Belum ada)';
    byAssignee.set(name, (byAssignee.get(name) ?? 0) + 1);
  }
  for (const [name, count] of [...byAssignee].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    line(name, count);
  }
}

export async function exportTasksToExcel(tasks: ProjectTaskView[], context: TaskExportContext) {
  const buffer = await buildTaskWorkbook(tasks, context);
  const url = URL.createObjectURL(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
  );
  const stamp = new Date().toISOString().slice(0, 10);
  const link = document.createElement('a');
  link.href = url;
  link.download = `task-activity-${context.projectName.replace(/\s+/g, '-').toLowerCase()}-${stamp}.xlsx`;
  link.click();
  URL.revokeObjectURL(url);
}

/** The workbook's bytes, apart from the download so it can run outside a browser. */
export async function buildTaskWorkbook(tasks: ProjectTaskView[], context: TaskExportContext) {
  // CommonJS underneath: depending on the bundler the classes arrive on the
  // namespace itself or on its `default`.
  const excel = await import('exceljs');
  const Workbook = excel.Workbook ?? excel.default.Workbook;

  const workbook = new Workbook();
  workbook.creator = 'D-Trace';
  workbook.created = new Date();

  taskSheet(workbook.addWorksheet('Task Activity'), tasks, context);
  summarySheet(workbook.addWorksheet('Ringkasan'), tasks, context);

  return workbook.xlsx.writeBuffer();
}
