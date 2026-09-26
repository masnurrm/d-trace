'use client';

import { Printer, X } from 'lucide-react';
import { Fragment, useEffect, useRef, type ReactNode } from 'react';
import {
  CHECKLIST_RESULT_LABELS,
  checklistItems,
  infoPair,
  infoSingle,
  isPairField,
  looksLikeHtml,
  plainTextToHtml,
  splitHeaderLine,
  templateAssetUrl,
  withDocumentDefaults,
  type ApprovalConfig,
  type ApprovalContent,
  type ChecklistConfig,
  type ChecklistContent,
  type DataConfig,
  type DataContent,
  type DocumentDetail,
  type HeaderConfig,
  type HeaderContent,
  type InfoConfig,
  type InfoContent,
  type InfoValue,
  type TableConfig,
  type TableContent,
  type TemplateSectionView,
  type TextContent,
} from '@dtrace/shared';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';
import { ProjectDataBlock } from '@/components/document-data/project-data-tables';
import { SectionAttachments } from '@/components/document-templates/section-attachments';
import { DocumentFillProvider, useFill } from '@/components/workspace/document-fill';
import { SectionField } from '@/components/workspace/document-fields';
import { RICH_TEXT_BODY_CLASS } from '@/components/workspace/rich-text-styles';

/**
 * A document laid out for paper — what "Download PDF" produces.
 *
 * The browser's own print engine does the PDF: it keeps text as text, draws
 * the tables and pictures exactly as CSS lays them out, and needs nothing
 * installed on the server. Three print rules carry the BPM's look (see the
 * `bpm` page in globals.css):
 *
 *  - the identification strip is the `<thead>` of one table wrapping the whole
 *    document, and a browser repeats a table's head on every printed page;
 *  - "Page X of Y" is an `@page` margin box, filled in by the print engine;
 *  - colours print, because the green of the mandays tables is information.
 *
 * Everything here is read-only. It prints what is saved, with the same
 * defaults the editor shows, so an unsaved-but-suggested company name prints
 * the way the author saw it.
 */
export function PrintDocument({
  document,
  autoPrint,
}: {
  document: DocumentDetail;
  autoPrint: boolean;
}) {
  const sections = (document.template?.sections ?? []).filter((section) => section.visible);
  const content = withDocumentDefaults(
    sections,
    document.content,
    document.context,
    document.projectData,
  );
  const header = sections.find((section) => section.type === 'HEADER');
  const printed = useRef(false);

  useEffect(() => {
    if (!autoPrint || printed.current) return;
    printed.current = true;

    // Print once every picture has arrived; a PDF with holes where the flow
    // diagrams should be is worse than a second's wait.
    const pending = Array.from(window.document.images).filter((image) => !image.complete);
    const loaded = pending.map(
      (image) =>
        new Promise<void>((resolve) => {
          image.addEventListener('load', () => resolve(), { once: true });
          image.addEventListener('error', () => resolve(), { once: true });
        }),
    );
    void Promise.all(loaded).then(() => window.setTimeout(() => window.print(), 300));
  }, [autoPrint]);

  return (
    <DocumentFillProvider context={document.context}>
      <div className="min-h-screen bg-slate-200 py-6 print:bg-white print:py-0">
        <div className="mx-auto mb-4 flex max-w-[210mm] flex-wrap items-center justify-between gap-3 rounded-lg bg-white px-4 py-3 shadow print:hidden">
          <div className="text-sm">
            <p className="font-semibold text-slate-900">{document.title}</p>
            <p className="text-xs text-slate-500">
              Pilih <b>Save as PDF</b> sebagai tujuan, dan matikan <b>Headers and footers</b> agar
              hasilnya bersih.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              leftIcon={<Printer className="h-4 w-4" aria-hidden />}
              onClick={() => window.print()}
            >
              Cetak / Simpan PDF
            </Button>
            <Button
              size="sm"
              variant="outline"
              leftIcon={<X className="h-4 w-4" aria-hidden />}
              onClick={() => window.close()}
            >
              Tutup
            </Button>
          </div>
        </div>

        <div className="print-document mx-auto w-[210mm] max-w-full bg-white px-[12mm] py-[10mm] text-slate-950 shadow-lg print:w-auto print:p-0 print:shadow-none">
          <table className="w-full border-collapse">
            {header?.type === 'HEADER' && (
              <thead>
                <tr>
                  <td className="pb-[3mm]">
                    <HeaderStrip
                      config={header.config}
                      fields={(content[header.key] as HeaderContent | undefined)?.fields ?? {}}
                    />
                  </td>
                </tr>
              </thead>
            )}
            <tbody>
              <tr>
                <td className="align-top">
                  {sections.map((section) => (
                    <Fragment key={section.key}>
                      <PrintSection
                        section={section}
                        value={content[section.key]}
                        document={document}
                      />
                      <SectionAttachments attachments={section.attachments ?? []} />
                    </Fragment>
                  ))}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </DocumentFillProvider>
  );
}

/* -------------------------------------------------------------------------- */

const border = 'border border-slate-950';
const cell = cn(border, 'px-[1.6mm] py-[0.8mm] align-top');

function PrintSection({
  section,
  value,
  document,
}: {
  section: TemplateSectionView;
  value: unknown;
  document: DocumentDetail;
}) {
  switch (section.type) {
    case 'HEADER':
      return (
        <HeaderTitle
          config={section.config}
          fields={(value as HeaderContent | undefined)?.fields ?? {}}
        />
      );
    case 'INFO':
      return <InfoBlock config={section.config} value={(value as InfoContent) ?? { rows: {} }} />;
    case 'TEXT':
      return <TextBlock title={section.title} value={(value as TextContent) ?? { text: '' }} />;
    case 'DATA':
      return (
        <DataBlock
          title={section.title}
          config={section.config}
          value={value as DataContent | undefined}
        />
      );
    case 'TABLE':
      return (
        <TableBlock
          title={section.title}
          config={section.config}
          value={(value as TableContent) ?? { cells: {}, extraRows: [] }}
        />
      );
    case 'APPROVAL':
      return (
        <ApprovalBlock
          config={section.config}
          value={(value as ApprovalContent) ?? { columns: {} }}
        />
      );
    case 'CHECKLIST':
      return (
        <ChecklistBlock
          title={section.title}
          config={section.config}
          value={(value as ChecklistContent) ?? { items: {}, itemOverrides: {} }}
        />
      );
    case 'FLOW':
      // A flow is a drawing, and the editor already draws it; disabled, its
      // boxes print as the labels they hold.
      return (
        <div className="text-[8pt]">
          <SectionField
            section={section}
            value={value}
            onChange={() => undefined}
            disabled
            documentId={document.id}
            liveData={document.projectData}
          />
        </div>
      );
  }
}

/** A bordered box with a bold title row, as every BPM section is drawn. */
function Frame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={cn(border, 'mt-[2.5mm]')}>
      <div className="break-after-avoid border-b border-slate-950 px-[1.6mm] py-[0.8mm] text-[11pt] font-bold">
        {title}
      </div>
      <div className="px-[1.6mm] py-[1.2mm]">{children}</div>
    </div>
  );
}

/** Template text with its `{{input:…}}` blanks replaced by this document's answers. */
function useHeaderLine(fields: Record<string, string>) {
  const fill = useFill();
  return (line: string) =>
    splitHeaderLine(line)
      .map((part) => (part.kind === 'text' ? fill(part.text) : (fields[part.key] ?? '')))
      .join('');
}

/** The strip that repeats at the top of every page. */
function HeaderStrip({ config, fields }: { config: HeaderConfig; fields: Record<string, string> }) {
  const line = useHeaderLine(fields);
  const lines = (list: string[], bold: number) =>
    list.map((text, index) => (
      <div key={index} className={index < bold ? 'text-[14pt] font-bold leading-tight' : 'text-[10pt]'}>
        {line(text)}
      </div>
    ));

  return (
    <table className="w-full border-collapse">
      <tbody>
        <tr>
          <td className={cn(border, 'w-[32%] px-[2mm] py-[1.5mm] text-center align-middle')}>
            {config.logoAssetId ? (
              // eslint-disable-next-line @next/next/no-img-element -- per-user BFF asset
              <img
                src={templateAssetUrl(config.logoAssetId)}
                alt={config.logoText || 'Logo'}
                className="mx-auto max-h-[16mm] max-w-full object-contain"
              />
            ) : (
              <span className="font-serif text-[26pt] font-bold text-rose-900">{config.logoText}</span>
            )}
          </td>
          <td className={cn(border, 'w-[36%] px-[2mm] py-[1.5mm] text-center align-middle')}>
            {lines(config.centerLines, config.centerBoldLines)}
          </td>
          <td className={cn(border, 'px-[2mm] py-[1.5mm] text-center align-middle')}>
            {lines(config.rightLines, config.rightBoldLines)}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

/** The yellow title and the title line: first page only, so part of the body. */
function HeaderTitle({ config, fields }: { config: HeaderConfig; fields: Record<string, string> }) {
  const line = useHeaderLine(fields);
  return (
    <div className="break-inside-avoid">
      {config.confidentialLabel && (
        <p className="mb-[1mm] text-center text-[9pt] font-extrabold">{config.confidentialLabel}</p>
      )}
      <div className={cn(border, 'bg-[#ffff99] py-[1mm] text-center text-[13pt] font-bold')}>
        {config.documentTitle}
      </div>
      <div className={cn(border, 'border-t-0 px-[1.6mm] py-[1mm] text-[11pt] font-bold')}>
        {config.titleLabel} : {line(config.titleValue)}
      </div>
    </div>
  );
}

function infoText(row: InfoConfig['rows'][number], value: InfoValue | undefined): string {
  if (isPairField(row.field)) {
    const [first, second] = infoPair(value);
    if (!first && !second) return '';
    if (row.field === 'DURATION') {
      return `${first} ${row.units[0] ?? ''} ${second} ${row.units[1] ?? ''}`.trim();
    }
    return `${first} s/d ${second}`;
  }
  return infoSingle(value);
}

function InfoBlock({ config, value }: { config: InfoConfig; value: InfoContent }) {
  const fill = useFill();
  const lines: { left: InfoConfig['rows'][number]; right?: InfoConfig['rows'][number] }[] = [];
  for (let index = 0; index < config.rows.length; index += 1) {
    const row = config.rows[index]!;
    const next = config.rows[index + 1];
    if (row.span === 'half' && next && next.span === 'half') {
      lines.push({ left: row, right: next });
      index += 1;
    } else {
      lines.push({ left: row });
    }
  }

  const text = (row: InfoConfig['rows'][number]) =>
    row.mode === 'FIXED' ? fill(row.value) : infoText(row, value.rows[row.id]);

  return (
    <table className="mt-[2.5mm] w-full border-collapse text-[10pt]">
      <tbody>
        {lines.map(({ left, right }) => (
          <tr key={left.id} className="break-inside-avoid">
            <td className={cn(cell, 'w-[20%]')}>{left.label}</td>
            <td className={cell} colSpan={right ? 1 : 3}>
              {text(left)}
            </td>
            {right && (
              <>
                <td className={cn(cell, 'w-[18%]')}>{right.label} :</td>
                <td className={cell}>{text(right)}</td>
              </>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TextBlock({ title, value }: { title: string; value: TextContent }) {
  const html = value.text && !looksLikeHtml(value.text) ? plainTextToHtml(value.text) : value.text;
  return (
    <Frame title={title}>
      {html ? (
        <div
          className={cn('text-[10.5pt] text-justify', RICH_TEXT_BODY_CLASS)}
          // Sanitised by the API on every save (rich-text.ts); this renders
          // exactly what the editor shows.
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <div className="h-[12mm]" />
      )}
    </Frame>
  );
}

function DataBlock({
  title,
  config,
  value,
}: {
  title: string;
  config: DataConfig;
  value: DataContent | undefined;
}) {
  return (
    <Frame title={title}>
      <div className="text-[9.5pt]">
        <ProjectDataBlock
          config={config}
          data={value?.data ?? null}
          effortTable={value?.effortTable}
          disabled
        />
      </div>
    </Frame>
  );
}

function TableBlock({
  title,
  config,
  value,
}: {
  title: string;
  config: TableConfig;
  value: TableContent;
}) {
  const fill = useFill();
  const rows = [
    ...config.rows.map((row, rowIndex) =>
      row.map((templateCell, columnIndex) =>
        templateCell.mode === 'FIXED'
          ? fill(templateCell.value)
          : (value.cells[`${rowIndex}:${columnIndex}`] ?? ''),
      ),
    ),
    ...value.extraRows,
  ];

  return (
    <Frame title={title}>
      <table className="w-full border-collapse text-[9.5pt]">
        {config.showHeader && (
          <thead>
            <tr>
              {config.numbered && <th className={cn(cell, 'w-[6%] bg-[#ffff99]')}>No</th>}
              {config.columns.map((column) => (
                <th
                  key={column.id}
                  className={cn(cell, 'bg-[#ffff99] font-bold')}
                  style={column.width ? { width: `${column.width}%` } : undefined}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="break-inside-avoid">
              {config.numbered && <td className={cn(cell, 'text-center')}>{rowIndex + 1}</td>}
              {config.columns.map((column, columnIndex) => (
                <td key={column.id} className={cell} style={{ textAlign: column.align }}>
                  {row[columnIndex] ?? ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Frame>
  );
}

function ApprovalBlock({ config, value }: { config: ApprovalConfig; value: ApprovalContent }) {
  const fill = useFill();
  return (
    <table className="mt-[2.5mm] w-full break-inside-avoid border-collapse text-[10.5pt]">
      <tbody>
        <tr>
          {config.columns.map((column) => {
            const answer = value.columns[column.id];
            const name = column.mode === 'FIXED' ? fill(column.name) : (answer?.name ?? '');
            return (
              <td key={column.id} className={cn(cell, 'align-top')} style={{ width: `${100 / config.columns.length}%` }}>
                <p className="font-bold">
                  {column.prefix} {column.label}
                </p>
                <div style={{ height: `${config.boxHeight}px` }} />
                {column.showDate && <p className="text-[9pt]">{answer?.date ?? ''}</p>}
                <p>{name}</p>
              </td>
            );
          })}
        </tr>
      </tbody>
    </table>
  );
}

function ChecklistBlock({
  title,
  config,
  value,
}: {
  title: string;
  config: ChecklistConfig;
  value: ChecklistContent;
}) {
  let number = 0;
  const columns = [
    config.showRemark && 'Remark',
    config.showChecker && 'Checker',
    config.showDate && 'Date',
    config.showEvidence && 'Evidence',
  ].filter(Boolean) as string[];

  return (
    <Frame title={title}>
      {config.filledByLabel && <p className="mb-[1mm] text-[9pt] italic">{config.filledByLabel}</p>}
      <table className="w-full border-collapse text-[9pt]">
        <thead>
          <tr>
            <th className={cn(cell, 'w-[5%] bg-[#ffff99]')}>No</th>
            <th className={cn(cell, 'bg-[#ffff99]')}>Item</th>
            <th className={cn(cell, 'w-[12%] bg-[#ffff99]')}>Result</th>
            {columns.map((label) => (
              <th key={label} className={cn(cell, 'bg-[#ffff99]')}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {config.groups.map((group) => (
            <Fragment key={group.id}>
              {group.title && (
                <tr className="break-inside-avoid">
                  <td colSpan={3 + columns.length} className={cn(cell, 'bg-slate-100 font-bold')}>
                    {group.title}
                  </td>
                </tr>
              )}
              {group.items.map((item) => {
                number += 1;
                const answer = value.items[item.id];
                return (
                  <tr key={item.id} className="break-inside-avoid">
                    <td className={cn(cell, 'text-center')}>{number}</td>
                    <td className={cell}>
                      <span className="whitespace-pre-line">
                        {value.itemOverrides[item.id]?.item ?? item.label}
                      </span>
                      {item.description && (
                        <span className="block text-[8pt] text-slate-600">{item.description}</span>
                      )}
                    </td>
                    <td className={cn(cell, 'text-center')}>
                      {answer?.result ? CHECKLIST_RESULT_LABELS[answer.result] : ''}
                    </td>
                    {config.showRemark && <td className={cell}>{answer?.remark ?? ''}</td>}
                    {config.showChecker && <td className={cell}>{answer?.checker ?? ''}</td>}
                    {config.showDate && <td className={cell}>{answer?.date ?? ''}</td>}
                    {config.showEvidence && (
                      <td className={cell}>
                        {answer?.evidence ?? ''}
                        {(answer?.evidenceFiles ?? []).map((file) => (
                          <div key={file.id}>{file.fileName}</div>
                        ))}
                      </td>
                    )}
                  </tr>
                );
              })}
            </Fragment>
          ))}
        </tbody>
      </table>
      {checklistItems(config).length === 0 && <p className="text-[9pt] italic">Belum ada item.</p>}
    </Frame>
  );
}
