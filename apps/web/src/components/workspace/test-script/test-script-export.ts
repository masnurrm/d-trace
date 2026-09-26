import {
  TEST_ENVIRONMENT_LABELS,
  TEST_RESULTS,
  TEST_RESULT_LABELS,
  TEST_SCRIPT_KIND_LABELS,
  TEST_SCRIPT_STATUS_LABELS,
  TEST_TYPE_LABELS,
  sectionLetter,
  summarizeTestScript,
  testCaptureUrl,
  type TestCaptureView,
  type TestEnvironment,
  type TestModuleView,
  type TestResult,
  type TestScriptKind,
  type TestScriptStatus,
  type TestSectionView,
} from '@dtrace/shared';
import type { Fill, Worksheet } from 'exceljs';

/**
 * A SIT or UAT script as an Excel workbook.
 *
 * Laid out the way the form is printed and signed: the identity block on top,
 * then each module as a band, each sub-section as a lighter band under it, and
 * the scenarios beneath with their own header row. The whole script is
 * exported, not the filtered view — this is the document, and a file that
 * silently dropped the OK rows would read as a script full of failures.
 *
 * exceljs is loaded on click, not with the page, as the other exports are.
 */

export interface TestScriptExportContext {
  projectName: string;
  kind: TestScriptKind;
  appName: string;
  version: string;
  testDate: string | null;
  environment: TestEnvironment;
  status: TestScriptStatus;
  submittedAt: string | null;
  submittedByName: string | null;
  modules: TestModuleView[];
  captures: Record<string, TestCaptureView>;
  /** Where the capture links point — they open through the app, signed in. */
  origin: string;
}

const HEADER_FILL = '0F766E';
const MODULE_FILL = 'CCFBF1';
const SECTION_FILL = 'F1F5F9';
const BORDER = 'E2E8F0';

const RESULT_FILL: Record<TestResult, string> = {
  OK: 'D1FAE5',
  NOK: 'FEE2E2',
  PENDING: 'FEF3C7',
};
const RESULT_FONT: Record<TestResult, string> = {
  OK: '047857',
  NOK: 'B91C1C',
  PENDING: '92400E',
};

const solid = (argb: string): Fill => ({
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: `FF${argb}` },
});

const COLUMNS: { header: string; width: number; wrap?: boolean }[] = [
  { header: 'No', width: 6 },
  { header: 'Role', width: 16, wrap: true },
  { header: 'Type Test', width: 11 },
  { header: 'Activity', width: 40, wrap: true },
  { header: 'Input', width: 30, wrap: true },
  { header: 'Expected Output', width: 40, wrap: true },
  { header: 'Result', width: 10 },
  { header: 'Notes', width: 28, wrap: true },
  { header: 'Paraf', width: 22, wrap: true },
  { header: 'Tester', width: 16, wrap: true },
  { header: 'Capture', width: 30, wrap: true },
];

const LAST = COLUMNS.length;

function flattenExportSections(
  sections: TestSectionView[],
  prefix = '',
): { section: TestSectionView; label: string }[] {
  return sections.flatMap((section, index) => {
    const label = prefix ? `${prefix}.${index + 1}` : sectionLetter(index);
    return [
      { section, label },
      ...flattenExportSections(section.children, label),
    ];
  });
}

function formatDay(day: string | null): string {
  if (!day) return '—';
  const [year, month, date] = day.split('-').map(Number);
  if (!year || !month || !date) return day;
  return new Date(Date.UTC(year, month - 1, date)).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function formatStamp(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '';
}

function scriptSheet(sheet: Worksheet, context: TestScriptExportContext) {
  sheet.columns = COLUMNS.map((column) => ({ width: column.width }));
  const edge = { style: 'thin' as const, color: { argb: `FF${BORDER}` } };
  const box = { top: edge, left: edge, bottom: edge, right: edge };

  sheet.getCell(1, 1).value = `Test Script — ${TEST_SCRIPT_KIND_LABELS[context.kind]}`;
  sheet.getCell(1, 1).font = { bold: true, size: 14 };
  sheet.getCell(2, 1).value =
    `${context.projectName} · diekspor ${new Date().toLocaleString('id-ID', { dateStyle: 'long', timeStyle: 'short' })}`;
  sheet.getCell(2, 1).font = { color: { argb: 'FF64748B' } };

  // Identity block, label and value in pairs.
  const identity: [string, string][] = [
    ['Nama Aplikasi', context.appName || '—'],
    ['Jenis Test', context.kind],
    ['Versi / Release', context.version || '—'],
    ['Tanggal Testing', formatDay(context.testDate)],
    ['Environment', TEST_ENVIRONMENT_LABELS[context.environment]],
    [
      'Status',
      context.status === 'SUBMITTED'
        ? `${TEST_SCRIPT_STATUS_LABELS.SUBMITTED} — ${context.submittedByName ?? '—'}, ${formatStamp(context.submittedAt)}`
        : TEST_SCRIPT_STATUS_LABELS[context.status],
    ],
  ];

  let r = 4;
  for (const [label, value] of identity) {
    sheet.mergeCells(r, 1, r, 2);
    sheet.getCell(r, 1).value = label;
    sheet.getCell(r, 1).font = { bold: true };
    sheet.getCell(r, 1).fill = solid(SECTION_FILL);
    sheet.mergeCells(r, 3, r, 6);
    sheet.getCell(r, 3).value = value;
    for (let c = 1; c <= 6; c += 1) sheet.getCell(r, c).border = box;
    r += 1;
  }
  r += 1;

  context.modules.forEach((module, mi) => {
    sheet.mergeCells(r, 1, r, LAST);
    const band = sheet.getCell(r, 1);
    band.value = `${mi + 1}. ${module.name || 'Modul tanpa nama'}`;
    band.font = { bold: true, size: 12, color: { argb: `FF${HEADER_FILL}` } };
    band.fill = solid(MODULE_FILL);
    sheet.getRow(r).height = 20;
    r += 1;

    flattenExportSections(module.sections).forEach(({ section, label }) => {
      sheet.mergeCells(r, 1, r, LAST);
      const sub = sheet.getCell(r, 1);
      sub.value = `${label}. ${section.name || 'Bagian tanpa nama'}`;
      sub.font = { bold: true };
      sub.fill = solid(SECTION_FILL);
      r += 1;

      const header = sheet.getRow(r);
      COLUMNS.forEach((column, index) => {
        const cell = header.getCell(index + 1);
        cell.value = column.header;
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = solid(HEADER_FILL);
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = box;
      });
      r += 1;

      section.rows.forEach((row, ri) => {
        const captureNames = row.captureIds.map(
          (id, index) => context.captures[id]?.fileName ?? `capture-${index + 1}`,
        );
        const paraf = row.paraf
          ? [row.parafByName ?? '✓', formatStamp(row.parafAt)].filter(Boolean).join('\n')
          : '';

        const values = [
          ri + 1,
          row.role,
          TEST_TYPE_LABELS[row.type],
          row.activity,
          row.input,
          row.expectedOutput,
          TEST_RESULT_LABELS[row.result],
          row.notes,
          paraf,
          row.tester,
          captureNames.join('\n'),
        ];

        const line = sheet.getRow(r);
        values.forEach((value, index) => {
          const cell = line.getCell(index + 1);
          cell.value = value;
          cell.border = box;
          cell.alignment = {
            vertical: 'top',
            wrapText: COLUMNS[index]!.wrap ?? false,
            horizontal: index === 0 || index === 2 || index === 6 ? 'center' : undefined,
          };
        });

        const result = line.getCell(7);
        result.fill = solid(RESULT_FILL[row.result]);
        result.font = { bold: true, color: { argb: `FF${RESULT_FONT[row.result]}` } };
        line.getCell(3).font = {
          bold: true,
          color: { argb: row.type === 'POSITIVE' ? 'FF047857' : 'FFB91C1C' },
        };

        // One capture is a clickable link; several are listed by name, since a
        // cell holds only one hyperlink.
        if (row.captureIds.length === 1) {
          line.getCell(11).value = {
            text: captureNames[0]!,
            hyperlink: `${context.origin}${testCaptureUrl(row.captureIds[0]!)}`,
          };
          line.getCell(11).font = { color: { argb: 'FF0369A1' }, underline: true };
        }

        r += 1;
      });

      r += 1;
    });
  });

  sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
}

function summarySheet(sheet: Worksheet, context: TestScriptExportContext) {
  sheet.columns = [{ width: 36 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 12 }];

  sheet.getCell('A1').value = `Ringkasan — ${TEST_SCRIPT_KIND_LABELS[context.kind]}`;
  sheet.getCell('A1').font = { bold: true, size: 14 };
  sheet.getCell('A2').value = context.projectName;
  sheet.getCell('A2').font = { color: { argb: 'FF64748B' } };

  const headers = ['Modul', 'Total', ...TEST_RESULTS.map((r) => TEST_RESULT_LABELS[r]), 'Pass rate'];
  const headerRow = sheet.getRow(4);
  headers.forEach((label, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = label;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = solid(HEADER_FILL);
  });

  let r = 5;
  const line = (label: string, modules: TestModuleView[], bold = false) => {
    const summary = summarizeTestScript(modules);
    const row = sheet.getRow(r);
    row.values = [label, summary.total, summary.ok, summary.nok, summary.pending, summary.passRate / 100];
    row.getCell(6).numFmt = '0%';
    if (bold) row.font = { bold: true };
    r += 1;
  };

  context.modules.forEach((module, index) => line(`${index + 1}. ${module.name}`, [module]));
  line('Total', context.modules, true);
}

export async function exportTestScriptToExcel(context: TestScriptExportContext) {
  const buffer = await buildTestScriptWorkbook(context);
  const url = URL.createObjectURL(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
  );
  const stamp = new Date().toISOString().slice(0, 10);
  const slug = context.projectName.replace(/\s+/g, '-').toLowerCase();
  const link = document.createElement('a');
  link.href = url;
  link.download = `test-script-${context.kind.toLowerCase()}-${slug}-${stamp}.xlsx`;
  link.click();
  URL.revokeObjectURL(url);
}

/** The workbook's bytes, apart from the download so it can run outside a browser. */
export async function buildTestScriptWorkbook(context: TestScriptExportContext) {
  // CommonJS underneath: depending on the bundler the classes arrive on the
  // namespace itself or on its `default`.
  const excel = await import('exceljs');
  const Workbook = excel.Workbook ?? excel.default.Workbook;

  const workbook = new Workbook();
  workbook.creator = 'D-Trace';
  workbook.created = new Date();

  scriptSheet(workbook.addWorksheet(`Test Script ${context.kind}`), context);
  summarySheet(workbook.addWorksheet('Ringkasan'), context);

  return workbook.xlsx.writeBuffer();
}
