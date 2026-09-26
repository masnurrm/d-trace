'use client';

import {
  edgeDirection,
  renderPlaceholders,
  splitHeaderLine,
  templateAssetUrl,
  INFO_FIELD_KIND_LABELS,
  type DataConfig,
  type ApprovalConfig,
  type ChecklistConfig,
  type FlowConfig,
  type HeaderConfig,
  type InfoConfig,
  type TableConfig,
  type TemplateSectionInput,
  type TextConfig,
} from '@dtrace/shared';
import { Fragment, type CSSProperties, type ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';
import {
  ProjectDataBlock,
  SAMPLE_PROJECT_DATA,
} from '@/components/document-data/project-data-tables';
import { SectionAttachments } from './section-attachments';

/**
 * The document as it will print.
 *
 * This renders the *template*, not a filled document, so the two kinds of
 * content are deliberately told apart: what the template fixes is drawn as
 * final text, and every blank a document author will fill is drawn as a dashed
 * placeholder. An operator designing a template needs to see which cells they
 * are deciding and which they are only reserving — a preview that showed both
 * the same way would hide the one choice this screen exists to make.
 */

/** Sample project data, so bindings render as something instead of as syntax. */
const SAMPLE_CONTEXT: Record<string, unknown> = {
  project: {
    name: 'CR ESS-HR – Additional PTK',
    code: 'ASMO3-001',
    company: 'PT Isuzu Astra Motor Indonesia',
    owner: 'Bapak Ali',
    email: 'ali@company.co.id',
    department: 'IT Manage Service 1',
    application: 'ESS-HR',
    startsAt: '5 Januari 2026',
    goLiveAt: '30 April 2026',
  },
  node: { name: 'ESS-HR', code: 'ESS_HR' },
  hierarchy: {
    MAIN_COMPANY: { name: 'AGIT', code: 'AGIT' },
    PROJECT_DEPARTMENT: { name: 'ASMO3', code: 'ASMO3' },
    COMPANY_PROJECT_DEPARTMENT: { name: 'IAMI', code: 'IAMI' },
    APP: { name: 'ESS-HR', code: 'ESS_HR' },
  },
  team: {
    TL: { name: 'Muhammad Eko Jumaddin', email: 'eko@agit.co.id', names: 'Muhammad Eko Jumaddin' },
    BA: { name: 'Budi', email: 'budi@agit.co.id', names: 'Budi' },
  },
  mandays: { total: '69' },
  today: '25 September 2026',
};

function fill(text: string | null | undefined): string {
  return text ? renderPlaceholders(text, SAMPLE_CONTEXT) : '';
}

/** A blank the document author fills in. Never confused with fixed content. */
function Blank({ label = 'diisi saat pembuatan dokumen' }: { label?: string }) {
  return (
    <span className="text-[9px] italic text-slate-400 dark:text-slate-500">{label}</span>
  );
}

function cellContent(mode: 'FIXED' | 'INPUT', value: string, blankLabel?: string): ReactNode {
  if (mode === 'FIXED') return fill(value) || <Blank label="—" />;
  return value ? (
    <span className="text-[9px] italic text-slate-400">{fill(value)}</span>
  ) : (
    <Blank label={blankLabel} />
  );
}

const cellClass = 'border border-slate-900 px-[7px] py-[5px] align-top text-[10px]';
const labelCellClass = cn(cellClass, 'bg-slate-50 font-bold dark:bg-slate-800');

function SectionFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-[7px] border border-slate-900">
      <div className="border-b border-slate-900 bg-slate-100 px-[7px] py-[5px] text-[10px] font-bold dark:bg-slate-800">
        {title}
      </div>
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Per-component renderers                                                     */
/* -------------------------------------------------------------------------- */

function HeaderBlock({ config }: { config: HeaderConfig }) {
  const cell = 'border border-slate-900 px-2 py-3 text-center align-middle';

  // A `{{input:…}}` blank is the document's to fill; the preview names it.
  const renderLine = (text: string) =>
    splitHeaderLine(text).map((part, index) =>
      part.kind === 'text' ? (
        <Fragment key={index}>{fill(part.text)}</Fragment>
      ) : (
        <span
          key={index}
          className="mx-0.5 inline-block rounded border border-dashed border-slate-400 px-1 text-[9px] font-normal italic text-slate-400"
        >
          {part.label}
        </span>
      ),
    );

  const lines = (list: string[], bold: number) =>
    list.map((line, index) => (
      <div key={index} className={index < bold ? 'text-[12px] font-bold' : 'text-[9px] font-normal'}>
        {renderLine(line)}
      </div>
    ));

  return (
    <div>
      {config.confidentialLabel && (
        <div className="mb-1 text-center text-[10px] font-extrabold">{config.confidentialLabel}</div>
      )}
      <table className="w-full border-collapse">
        <tbody>
          <tr>
            <td className={cn(cell, 'w-[30%] font-serif text-[28px] font-bold text-rose-900')}>
              {config.logoAssetId ? (
                // eslint-disable-next-line @next/next/no-img-element -- per-user BFF asset
                <img
                  src={templateAssetUrl(config.logoAssetId)}
                  alt={config.logoText || 'Logo'}
                  className="mx-auto max-h-14 max-w-full object-contain"
                />
              ) : (
                config.logoText
              )}
            </td>
            <td className={cn(cell, 'w-[38%]')}>{lines(config.centerLines, config.centerBoldLines)}</td>
            <td className={cell}>{lines(config.rightLines, config.rightBoldLines)}</td>
          </tr>
        </tbody>
      </table>

      <div className="mt-[7px] border border-slate-900 bg-[#ffff99] p-[6px] text-center text-[13px] font-black">
        {config.documentTitle}
      </div>
      <div className="border border-t-0 border-slate-900 p-[6px] text-[10px] font-bold">
        {config.titleLabel} : {renderLine(config.titleValue)}
      </div>
    </div>
  );
}

/**
 * A DATA section with sample numbers: the table's shape is the designer's
 * decision, the numbers will be each project's own.
 */
function DataBlock({ title, config }: { title: string; config: DataConfig }) {
  return (
    <SectionFrame title={title}>
      <div className="p-[7px] text-[10px]">
        <ProjectDataBlock config={config} data={SAMPLE_PROJECT_DATA[config.dataset]} />
        <p className="mt-1 text-[9px] italic text-slate-400">
          Contoh angka — di dokumen diambil dari Mandays &amp; Timeline project.
        </p>
      </div>
    </SectionFrame>
  );
}

/**
 * What the blank in a typed row should announce.
 *
 * A row that will offer three choices and a row that will offer a date look
 * identical in a preview unless the blank says so, and that is exactly the
 * thing a designer is here to check.
 */
function blankFor(row: InfoConfig['rows'][number]): string | undefined {
  if (row.mode !== 'INPUT') return undefined;
  if (row.field === 'SELECT') {
    return row.options.length > 0 ? row.options.join(' / ') : 'Pilihan';
  }
  if (row.field === 'DURATION') {
    return row.units.filter(Boolean).join(' / ') || INFO_FIELD_KIND_LABELS[row.field];
  }
  if (row.field === 'TEXT') return undefined;
  return INFO_FIELD_KIND_LABELS[row.field];
}

function InfoBlock({ config }: { config: InfoConfig }) {
  // `half` rows pair up into one physical row of four cells; a `full` row (or a
  // `half` with no partner) spans the rest of the width instead of leaving a
  // ragged gap at the end of the grid.
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

  return (
    <table className="mt-[7px] w-full border-collapse">
      <tbody>
        {lines.map(({ left, right }) => (
          <tr key={left.id}>
            <td className={cn(labelCellClass, 'w-[20%]')}>{left.label}</td>
            <td className={cellClass} colSpan={right ? 1 : 3}>
              {cellContent(left.mode, left.value, blankFor(left))}
            </td>
            {right && (
              <>
                <td className={cn(labelCellClass, 'w-[20%]')}>{right.label}</td>
                <td className={cellClass}>{cellContent(right.mode, right.value, blankFor(right))}</td>
              </>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TextBlock({
  title,
  content,
  config,
  source,
  binding,
}: {
  title: string;
  content: string | null;
  config: TextConfig;
  source: TemplateSectionInput['source'];
  binding: string | null;
}) {
  const body = fill(content);
  const bound = source !== 'MANUAL' && binding ? fill(`{{${binding}}}`) : '';
  const text = body || (bound && !bound.startsWith('{{') ? bound : '');

  return (
    <SectionFrame title={title}>
      <div
        className="whitespace-pre-wrap p-[7px] text-[10px] leading-relaxed"
        style={{ minHeight: `${config.minRows * 16}px` }}
      >
        {text || <Blank label={config.placeholder || 'diisi saat pembuatan dokumen'} />}
      </div>
    </SectionFrame>
  );
}

function FlowBlock({ title, config }: { title: string; config: FlowConfig }) {
  if (config.nodes.length === 0) {
    return (
      <SectionFrame title={title}>
        <div className="p-4 text-center">
          <Blank label="Flow belum punya node" />
        </div>
      </SectionFrame>
    );
  }

  const maxRow = Math.max(...config.nodes.map((node) => node.row));
  const maxCol = Math.max(...config.nodes.map((node) => node.col));

  // The grid interleaves node tracks with narrow gap tracks, and an arrow is
  // drawn in the gap between two orthogonally adjacent nodes. That is what lets
  // the editor grow the diagram in any of the four directions without ever
  // needing to lay out a connector by hand.
  const style: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: Array.from({ length: maxCol * 2 + 1 }, (_, index) =>
      index % 2 === 0 ? 'minmax(64px, max-content)' : 'auto',
    ).join(' '),
    gridTemplateRows: Array.from({ length: maxRow * 2 + 1 }, (_, index) =>
      index % 2 === 0 ? 'auto' : 'auto',
    ).join(' '),
    justifyContent: 'center',
    alignItems: 'center',
    justifyItems: 'center',
    columnGap: '2px',
    rowGap: '2px',
  };

  const byId = new Map(config.nodes.map((node) => [node.id, node]));

  return (
    <SectionFrame title={title}>
      <div className="overflow-x-auto p-[10px]">
        <div style={style}>
          {config.nodes.map((node) => (
            <div
              key={node.id}
              style={{ gridColumn: node.col * 2 + 1, gridRow: node.row * 2 + 1 }}
              className={cn(
                'w-full rounded border px-2 py-1.5 text-center text-[9px] font-bold',
                node.mode === 'FIXED'
                  ? 'border-sky-300 bg-sky-50 text-sky-700'
                  : 'border-dashed border-slate-300 bg-white text-slate-400 italic',
              )}
            >
              {node.label || (node.mode === 'INPUT' ? 'diisi user' : '—')}
            </div>
          ))}

          {config.edges.map((edge) => {
            const from = byId.get(edge.from);
            const to = byId.get(edge.to);
            if (!from || !to) return null;

            const direction = edgeDirection(from, to);
            // Only adjacent pairs have a gap track to draw into. A longer edge
            // stays in the data — moving a node must never silently drop a
            // connection — it simply has nowhere to be painted.
            if (!direction) return null;

            const horizontal = direction === 'right' || direction === 'left';
            const glyph = { right: '→', left: '←', down: '↓', up: '↑' }[direction];

            return (
              <div
                key={edge.id}
                style={{
                  gridColumn: horizontal
                    ? Math.min(from.col, to.col) * 2 + 2
                    : from.col * 2 + 1,
                  gridRow: horizontal
                    ? from.row * 2 + 1
                    : Math.min(from.row, to.row) * 2 + 2,
                }}
                className="px-0.5 text-[11px] leading-none text-slate-500"
                aria-hidden
              >
                {glyph}
              </div>
            );
          })}
        </div>
      </div>
    </SectionFrame>
  );
}

function TableBlock({ title, config }: { title: string; config: TableConfig }) {
  return (
    <SectionFrame title={title}>
      <div className="overflow-x-auto p-[6px]">
        <table className="w-full border-collapse">
          {config.showHeader && (
            <thead>
              <tr>
                {config.numbered && (
                  <th className={cn(labelCellClass, 'w-[6%] text-center')}>No</th>
                )}
                {config.columns.map((column) => (
                  <th
                    key={column.id}
                    className={cn(labelCellClass, 'text-left')}
                    style={column.width ? { width: `${column.width}%` } : undefined}
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {config.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {config.numbered && (
                  <td className={cn(cellClass, 'text-center')}>{rowIndex + 1}</td>
                )}
                {row.map((cell, columnIndex) => (
                  <td
                    key={config.columns[columnIndex]?.id ?? columnIndex}
                    className={cellClass}
                    style={{ textAlign: config.columns[columnIndex]?.align ?? 'left' }}
                  >
                    {cellContent(cell.mode, cell.value, '—')}
                  </td>
                ))}
              </tr>
            ))}
            {config.allowUserRows && (
              <tr>
                <td
                  className={cn(cellClass, 'text-center')}
                  colSpan={config.columns.length + (config.numbered ? 1 : 0)}
                >
                  <Blank label="user dapat menambah baris" />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </SectionFrame>
  );
}

function ApprovalBlock({ config }: { config: ApprovalConfig }) {
  const width = `${100 / config.columns.length}%`;

  return (
    <table className="mt-[7px] w-full border-collapse">
      <tbody>
        <tr>
          {config.columns.map((column) => (
            <td
              key={column.id}
              className="border border-slate-900 p-[6px] align-top text-[9px]"
              style={{ width, height: `${config.boxHeight}px` }}
            >
              <b>
                {column.prefix} {column.label},
              </b>
              <div className="mt-auto pt-[calc(100%-28px)] text-center">
                {column.mode === 'FIXED' && column.name ? (
                  <span className="border-t border-slate-400 px-3 pt-0.5">{column.name}</span>
                ) : (
                  <Blank label="( nama & tanda tangan )" />
                )}
                {column.showDate && (
                  <div className="mt-1 text-[8px] text-slate-400">Tanggal: ____________</div>
                )}
              </div>
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  );
}

/* -------------------------------------------------------------------------- */
/* The page                                                                    */
/* -------------------------------------------------------------------------- */

export interface DocumentPreviewProps {
  sections: TemplateSectionInput[];
  /** Highlighted in the page and clickable, so the preview drives selection. */
  selectedKey?: string | null;
  onSelect?: (key: string) => void;
}

export function DocumentPreview({ sections, selectedKey, onSelect }: DocumentPreviewProps) {
  const visible = sections.filter((section) => section.visible);

  return (
    <div className="bg-slate-100 p-5 dark:bg-slate-950">
      <div className="mx-auto min-h-[900px] w-full max-w-[810px] bg-white p-7 text-slate-900 shadow-lg">
        {visible.length === 0 && (
          <p className="py-20 text-center text-sm text-slate-400">
            Belum ada section yang tampil. Tambahkan section di panel kiri.
          </p>
        )}

        {visible.map((section) => (
          <div
            key={section.key}
            role={onSelect ? 'button' : undefined}
            tabIndex={onSelect ? 0 : undefined}
            onClick={onSelect ? () => onSelect(section.key) : undefined}
            onKeyDown={
              onSelect
                ? (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelect(section.key);
                    }
                  }
                : undefined
            }
            className={cn(
              'text-left',
              onSelect && 'cursor-pointer',
              section.key === selectedKey && 'outline-2 outline-offset-2 outline-sky-600',
            )}
          >
            <SectionBlock section={section} />
            <SectionAttachments attachments={section.attachments} />
          </div>
        ))}

        <p className="mt-3 text-center text-[9px] text-slate-500">Page 1 of 1</p>
      </div>
    </div>
  );
}

function SectionBlock({ section }: { section: TemplateSectionInput }) {
  switch (section.type) {
    case 'HEADER':
      return <HeaderBlock config={section.config} />;
    case 'INFO':
      return <InfoBlock config={section.config} />;
    case 'TEXT':
      return (
        <TextBlock
          title={section.title}
          content={section.content}
          config={section.config}
          source={section.source}
          binding={section.binding}
        />
      );
    case 'FLOW':
      return <FlowBlock title={section.title} config={section.config} />;
    case 'TABLE':
      return <TableBlock title={section.title} config={section.config} />;
    case 'APPROVAL':
      return <ApprovalBlock config={section.config} />;
    case 'CHECKLIST':
      return <ChecklistBlock title={section.title} config={section.config} />;
    case 'DATA':
      return <DataBlock title={section.title} config={section.config} />;
  }
}

/**
 * A checklist as the builder shows it: the items, and a blank where each
 * answer will go.
 *
 * The counter is drawn at zero rather than left out. A designer adding a group
 * needs to see the total move — twenty-nine items is a different form from
 * nine, and that is a decision made here, not while filling it in.
 */
function ChecklistBlock({ title, config }: { title: string; config: ChecklistConfig }) {
  const total = config.groups.reduce((sum, group) => sum + group.items.length, 0);
  const columns =
    3 +
    (config.showRemark ? 1 : 0) +
    (config.showChecker ? 1 : 0) +
    (config.showDate ? 1 : 0) +
    (config.showEvidence ? 1 : 0);

  let index = 0;

  return (
    <SectionFrame title={title}>
      {config.filledByLabel && (
        <p className="border-b border-slate-900 px-[7px] py-[5px] text-[9px] italic text-slate-500">
          {config.filledByLabel}
        </p>
      )}
      <p className="border-b border-slate-900 px-[7px] py-[5px] text-[9px] text-slate-500">
        <b className="text-slate-900 dark:text-slate-100">{total}</b> item · 0 Done · 0 No Need ·{' '}
        <b className="text-slate-900 dark:text-slate-100">{total}</b> Pending
      </p>

      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={cn(labelCellClass, 'w-[34px] text-center')}>No</th>
            <th className={cn(labelCellClass, 'text-left')}>Item</th>
            <th className={cn(labelCellClass, 'w-[100px] text-left')}>Checklist Result</th>
            {config.showRemark && <th className={cn(labelCellClass, 'text-left')}>Remark</th>}
            {config.showChecker && (
              <th className={cn(labelCellClass, 'w-[100px] text-left')}>Checker</th>
            )}
            {config.showDate && <th className={cn(labelCellClass, 'w-[90px] text-left')}>Date</th>}
            {config.showEvidence && (
              <th className={cn(labelCellClass, 'w-[100px] text-left')}>Evidence</th>
            )}
          </tr>
        </thead>
        <tbody>
          {config.groups.map((group) => (
            <Fragment key={group.id}>
              <tr>
                <td
                  colSpan={columns}
                  className={cn(cellClass, 'bg-sky-50 font-bold text-sky-700 dark:bg-sky-950 dark:text-sky-300')}
                >
                  {group.title || <Blank label="Nama kelompok" />}
                </td>
              </tr>
              {group.items.map((item) => {
                index += 1;
                return (
                  <tr key={item.id}>
                    <td className={cn(cellClass, 'text-center text-slate-500')}>{index}</td>
                    <td className={cellClass}>
                      {item.label}
                      {item.description && (
                        <span className="mt-0.5 block text-slate-500">{item.description}</span>
                      )}
                    </td>
                    <td className={cellClass}>
                      <Blank label="Done / No Need" />
                    </td>
                    {config.showRemark && (
                      <td className={cellClass}>
                        <Blank />
                      </td>
                    )}
                    {config.showChecker && (
                      <td className={cellClass}>
                        <Blank />
                      </td>
                    )}
                    {config.showDate && (
                      <td className={cellClass}>
                        <Blank />
                      </td>
                    )}
                    {config.showEvidence && (
                      <td className={cellClass}>
                        <Blank />
                      </td>
                    )}
                  </tr>
                );
              })}
            </Fragment>
          ))}

          {total === 0 && (
            <tr>
              <td colSpan={columns} className={cn(cellClass, 'text-center italic text-slate-400')}>
                Checklist belum punya item.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </SectionFrame>
  );
}
