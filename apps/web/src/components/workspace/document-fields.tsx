'use client';

import {
  CHECKLIST_RESULTS,
  CHECKLIST_RESULT_LABELS,
  edgeDirection,
  infoPair,
  infoSingle,
  documentImageUrl,
  hasPlaceholder,
  isPairField,
  splitHeaderLine,
  tallyChecklist,
  templateAssetUrl,
  type DataConfig,
  type DataContent,
  type HeaderContent,
  type ProjectDataSet,
  type ApprovalConfig,
  type ApprovalContent,
  type ChecklistAnswer,
  type ChecklistConfig,
  type ChecklistContent,
  type ChecklistResult,
  type InfoValue,
  type FlowConfig,
  type FlowContent,
  type HeaderConfig,
  type InfoConfig,
  type InfoContent,
  type TableConfig,
  type TableContent,
  type TemplateSectionView,
  type TextConfig,
  type TextContent,
} from '@dtrace/shared';
import { Fragment, useState, type CSSProperties } from 'react';
import { Paperclip, RefreshCw, Upload, X } from 'lucide-react';
import { ApiClientError, clientFetch } from '@/lib/api/client';
import { cn } from '@/lib/utils/cn';
import { ProjectDataBlock } from '@/components/document-data/project-data-tables';
import { useFill } from './document-fill';
import { RichTextEditor } from './rich-text-editor';

/**
 * A document as it is filled in.
 *
 * The same page the template preview draws, except that every blank the
 * template reserved is now an input. What the template fixed stays printed
 * text: an author cannot edit it here, because it is not theirs to decide —
 * that choice was made once, in the master template, and holds for every
 * document produced from it.
 */

const cellClass = 'border border-slate-900 px-[7px] py-[5px] align-top text-[10px]';
const labelCellClass = cn(cellClass, 'bg-slate-50 font-bold dark:bg-slate-800');

const inputClass =
  'w-full rounded border border-sky-300 bg-sky-50/40 px-1.5 py-1 text-[10px] text-slate-900 focus:border-sky-500 focus:outline-none disabled:border-slate-200 disabled:bg-transparent disabled:text-slate-600';

export interface SectionFieldProps {
  section: TemplateSectionView;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled: boolean;
  /** Where embedded pictures are uploaded to. */
  documentId: string;
  /** The project's numbers as they are now, for a DATA section's refresh. */
  liveData: ProjectDataSet;
}

/** Routes a section to the editor its component type calls for. */
export function SectionField({
  section,
  value,
  onChange,
  disabled,
  documentId,
  liveData,
}: SectionFieldProps) {
  switch (section.type) {
    case 'HEADER':
      return (
        <HeaderBlock
          config={section.config}
          value={(value as HeaderContent) ?? { fields: {} }}
          onChange={onChange}
          disabled={disabled}
        />
      );
    case 'DATA':
      return (
        <DataField
          title={section.title}
          config={section.config}
          value={(value as DataContent) ?? { capturedAt: null, refresh: false, data: null }}
          live={liveData[section.config.dataset] ?? null}
          onChange={onChange}
          disabled={disabled}
        />
      );
    case 'TEXT':
      return (
        <TextField
          title={section.title}
          config={section.config}
          fallback={section.content}
          value={(value as TextContent) ?? { text: '' }}
          onChange={onChange}
          disabled={disabled}
          documentId={documentId}
        />
      );
    case 'INFO':
      return (
        <InfoFields
          config={section.config}
          value={(value as InfoContent) ?? { rows: {} }}
          onChange={onChange}
          disabled={disabled}
        />
      );
    case 'FLOW':
      return (
        <FlowFields
          title={section.title}
          config={section.config}
          value={(value as FlowContent) ?? { nodes: {} }}
          onChange={onChange}
          disabled={disabled}
        />
      );
    case 'TABLE':
      return (
        <TableFields
          title={section.title}
          config={section.config}
          value={(value as TableContent) ?? { cells: {}, extraRows: [] }}
          onChange={onChange}
          disabled={disabled}
        />
      );
    case 'APPROVAL':
      return (
        <ApprovalFields
          config={section.config}
          value={(value as ApprovalContent) ?? { columns: {} }}
          onChange={onChange}
          disabled={disabled}
        />
      );
    case 'CHECKLIST':
      return (
        <ChecklistFields
          title={section.title}
          config={section.config}
          value={(value as ChecklistContent) ?? { items: {} }}
          onChange={onChange}
          disabled={disabled}
          documentId={documentId}
        />
      );
  }
}

function SectionFrame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-[7px] border border-slate-900">
      <div className="border-b border-slate-900 bg-slate-100 px-[7px] py-[5px] text-[10px] font-bold dark:bg-slate-800">
        {title}
      </div>
      {children}
    </div>
  );
}

function HeaderBlock({
  config,
  value,
  onChange,
  disabled,
}: {
  config: HeaderConfig;
  value: HeaderContent;
  onChange: (value: HeaderContent) => void;
  disabled: boolean;
}) {
  const fill = useFill();
  const cell = 'border border-slate-900 px-2 py-2 text-center align-middle';

  // A line is template text with, possibly, a blank or two the document fills.
  const renderLine = (text: string) =>
    splitHeaderLine(text).map((part, index) =>
      part.kind === 'text' ? (
        <Fragment key={index}>{fill(part.text)}</Fragment>
      ) : (
        <input
          key={index}
          aria-label={part.label}
          placeholder={part.label}
          maxLength={200}
          disabled={disabled}
          value={value.fields[part.key] ?? ''}
          onChange={(event) =>
            onChange({ ...value, fields: { ...value.fields, [part.key]: event.target.value } })
          }
          className={cn(inputClass, 'mx-0.5 inline-block w-32 text-center font-normal')}
        />
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
 * Numbers taken from another screen, with the date they were taken.
 *
 * Nothing here is typed. Until the first save the live numbers are shown; the
 * save freezes them. "Perbarui" asks for the current ones — the server takes
 * them, not this component, which only shows what they will be.
 */
function DataField({
  title,
  config,
  value,
  live,
  onChange,
  disabled,
}: {
  title: string;
  config: DataConfig;
  value: DataContent;
  live: DataContent['data'];
  onChange: (value: DataContent) => void;
  disabled: boolean;
}) {
  const data = value.data ?? live;
  const status = value.refresh
    ? 'Memakai data terbaru dari Mandays — dibekukan saat dokumen disimpan.'
    : value.capturedAt
      ? `Data diambil dari Mandays pada ${new Intl.DateTimeFormat('id-ID', {
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(new Date(value.capturedAt))}.`
      : 'Belum dibekukan — data Mandays saat ini akan disimpan bersama dokumen.';

  return (
    <SectionFrame title={title}>
      <div className="p-[7px] text-[10px]">
        <ProjectDataBlock
          config={config}
          data={data}
          effortTable={value.effortTable}
          onEffortTableChange={(effortTable) => onChange({ ...value, effortTable })}
          disabled={disabled}
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-dashed border-slate-300 pt-1.5 text-[9px] text-slate-500">
          <span>{status}</span>
          {!disabled && value.capturedAt && !value.refresh && (
            <button
              type="button"
              onClick={() => onChange({ ...value, refresh: true, data: live ?? value.data })}
              className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-0.5 font-medium text-slate-700 hover:bg-slate-50"
            >
              <RefreshCw className="h-3 w-3" aria-hidden />
              Perbarui dari Mandays
            </button>
          )}
        </div>
      </div>
    </SectionFrame>
  );
}

function TextField({
  title,
  config,
  fallback,
  value,
  onChange,
  disabled,
  documentId,
}: {
  title: string;
  config: TextConfig;
  fallback: string | null;
  value: TextContent;
  onChange: (value: TextContent) => void;
  disabled: boolean;
  documentId: string;
}) {
  const fill = useFill();

  async function uploadImage(file: File): Promise<string> {
    const form = new FormData();
    form.append('file', file);
    try {
      const result = await clientFetch<{ id: string }>(
        `/workspace/documents/${documentId}/images`,
        { method: 'POST', body: form },
      );
      return documentImageUrl(result.data.id);
    } catch (caught) {
      // The field-level message ("Hanya gambar PNG…") says more than the envelope's.
      if (caught instanceof ApiClientError) {
        throw new Error(caught.details?.[0]?.message ?? caught.message);
      }
      throw caught;
    }
  }

  return (
    <SectionFrame title={title}>
      <div className="p-[7px]">
        <RichTextEditor
          label={title}
          minRows={config.minRows}
          value={value.text}
          disabled={disabled}
          placeholder={config.placeholder || fill(fallback) || 'Tulis isi bagian ini…'}
          onChange={(text) => onChange({ text })}
          onUploadImage={uploadImage}
        />
      </div>
    </SectionFrame>
  );
}

function InfoFields({
  config,
  value,
  onChange,
  disabled,
}: {
  config: InfoConfig;
  value: InfoContent;
  onChange: (value: InfoContent) => void;
  disabled: boolean;
}) {
  // Half-width rows pair into one physical row, exactly as the preview lays
  // them out — the document on screen has to match the document that prints.
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

  const fill = useFill();
  const set = (id: string, next: InfoValue) =>
    onChange({ ...value, rows: { ...value.rows, [id]: next } });

  const cellFor = (row: InfoConfig['rows'][number]) =>
    row.mode === 'FIXED' ? (
      fill(row.value)
    ) : (
      <InfoControl
        row={row}
        value={value.rows[row.id]}
        onChange={(next) => set(row.id, next)}
        disabled={disabled}
      />
    );

  return (
    <table className="mt-[7px] w-full border-collapse">
      <tbody>
        {lines.map(({ left, right }) => (
          <tr key={left.id}>
            <td className={cn(labelCellClass, 'w-[20%]')}>{left.label}</td>
            <td className={cellClass} colSpan={right ? 1 : 3}>
              {cellFor(left)}
            </td>
            {right && (
              <>
                <td className={cn(labelCellClass, 'w-[20%]')}>{right.label}</td>
                <td className={cellClass}>{cellFor(right)}</td>
              </>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * The control one `INPUT` info row asks for.
 *
 * A native `<select>` and native date inputs rather than the app's combobox and
 * field components: this subtree is a facsimile of a printed form, drawn at
 * 10px inside a bordered grid, and the design-system controls are built for a
 * page rather than for a form cell. The rule against `<select>` is about the
 * app's own screens; a document that has to print like its paper original is
 * the one place it does not reach.
 */
function InfoControl({
  row,
  value,
  onChange,
  disabled,
}: {
  row: InfoConfig['rows'][number];
  value: InfoValue | undefined;
  onChange: (value: InfoValue) => void;
  disabled: boolean;
}) {
  const common = {
    disabled,
    className: inputClass,
    'aria-label': row.label,
    // A binding became the default answer already; plain text is only a hint.
    placeholder: row.value && !hasPlaceholder(row.value) ? row.value : undefined,
  };

  if (isPairField(row.field)) {
    const [start, end] = infoPair(value);
    const type =
      row.field === 'DATETIME_RANGE' ? 'datetime-local' : row.field === 'DATE_RANGE' ? 'date' : 'number';
    const [firstUnit, secondUnit] = row.units;
    const separator = row.field === 'DURATION' ? null : 's/d';

    return (
      <span className="flex items-center gap-1.5">
        <input
          {...common}
          type={type}
          min={type === 'number' ? 0 : undefined}
          value={start}
          aria-label={`${row.label} — ${firstUnit ?? 'mulai'}`}
          onChange={(event) => onChange([event.target.value, end])}
        />
        {(separator ?? firstUnit) && (
          <span className="shrink-0 text-[9px] text-slate-500">{separator ?? firstUnit}</span>
        )}
        <input
          {...common}
          type={type}
          min={type === 'number' ? 0 : undefined}
          value={end}
          aria-label={`${row.label} — ${secondUnit ?? 'selesai'}`}
          onChange={(event) => onChange([start, event.target.value])}
        />
        {separator === null && secondUnit && (
          <span className="shrink-0 text-[9px] text-slate-500">{secondUnit}</span>
        )}
      </span>
    );
  }

  const single = infoSingle(value);

  switch (row.field) {
    case 'SELECT':
      return (
        <select
          {...common}
          value={single}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">— Pilih —</option>
          {row.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
    case 'TEXTAREA':
      return (
        <textarea
          {...common}
          rows={3}
          maxLength={2000}
          value={single}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    case 'NUMBER':
      return (
        <input
          {...common}
          type="number"
          min={0}
          value={single}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    case 'DATE':
    case 'DATETIME':
      return (
        <input
          {...common}
          type={row.field === 'DATETIME' ? 'datetime-local' : 'date'}
          value={single}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    default:
      return (
        <input
          {...common}
          maxLength={2000}
          value={single}
          onChange={(event) => onChange(event.target.value)}
        />
      );
  }
}

const EMPTY_ANSWER: ChecklistAnswer = {
  result: null,
  remark: '',
  checker: '',
  date: '',
  evidence: '',
  evidenceFiles: [],
};

const RESULT_CELL: Record<ChecklistResult, string> = {
  NO_NEED: 'bg-slate-100 font-semibold text-slate-600',
  NEED: 'bg-rose-50 font-semibold text-rose-700',
  IN_PROGRESS: 'bg-amber-50 font-semibold text-amber-800',
  CLOSED: 'bg-emerald-50 font-semibold text-emerald-700',
};

/**
 * The verification checklist, as it is filled in.
 *
 * The counter above the table is the reason this is its own component rather
 * than a table with a constrained column: the question a release checklist
 * exists to answer is "what is still outstanding", and on twenty-nine rows
 * spread over five groups that is not something anybody reads off the grid.
 * Pending is derived — total minus answered — so it cannot drift from the rows
 * below it.
 */
function ChecklistFields({
  title,
  config,
  value,
  onChange,
  disabled,
  documentId,
}: {
  title: string;
  config: ChecklistConfig;
  value: ChecklistContent;
  onChange: (value: ChecklistContent) => void;
  disabled: boolean;
  documentId: string;
}) {
  const [uploadingEvidence, setUploadingEvidence] = useState<string | null>(null);
  const [evidenceError, setEvidenceError] = useState<Record<string, string>>({});
  const all = config.groups.flatMap((group) => group.items);
  const answerOf = (id: string) => value.items[id] ?? EMPTY_ANSWER;

  const tally = tallyChecklist(all.map((item) => answerOf(item.id).result));

  const patch = (id: string, changes: Partial<ChecklistAnswer>) =>
    onChange({
      ...value,
      items: { ...value.items, [id]: { ...answerOf(id), ...changes } },
    });

  const markAllClosed = () =>
    onChange({
      ...value,
      items: Object.fromEntries(
        all.map((item) => [item.id, { ...answerOf(item.id), result: 'CLOSED' as const }]),
      ),
    });

  async function uploadEvidence(itemId: string, file: File | undefined) {
    if (!file) return;
    const answer = answerOf(itemId);
    if (answer.evidenceFiles.length >= 10) {
      setEvidenceError((current) => ({ ...current, [itemId]: 'Maksimal 10 berkas per item.' }));
      return;
    }

    setUploadingEvidence(itemId);
    setEvidenceError((current) => ({ ...current, [itemId]: '' }));
    const form = new FormData();
    form.append('file', file);

    try {
      const result = await clientFetch<{ id: string; fileName: string; mimeType: string }>(
        `/workspace/documents/${documentId}/files`,
        { method: 'POST', body: form },
      );
      patch(itemId, {
        evidenceFiles: [
          ...answer.evidenceFiles,
          {
            id: result.data.id,
            fileName: result.data.fileName,
            mimeType: result.data.mimeType,
          },
        ],
      });
    } catch (caught) {
      setEvidenceError((current) => ({
        ...current,
        [itemId]: caught instanceof ApiClientError ? caught.message : 'Evidence gagal diunggah.',
      }));
    } finally {
      setUploadingEvidence(null);
    }
  }

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

      <div className="flex flex-wrap items-center gap-3 border-b border-slate-900 px-[7px] py-[6px]">
        <div className="h-1.5 min-w-[140px] flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
          <div
            className="h-full bg-emerald-500 transition-[width] duration-200"
            style={{ width: `${tally.settledPercent}%` }}
          />
        </div>
        <p className="text-[9px] text-slate-500">
          {CHECKLIST_RESULTS.map((result) => (
            <Fragment key={result}>
              <b className="text-slate-900 dark:text-slate-100">{tally.counts[result]}</b>{' '}
              {CHECKLIST_RESULT_LABELS[result]} ·{' '}
            </Fragment>
          ))}
          <b className="text-slate-900 dark:text-slate-100">{tally.unanswered}</b> Belum diisi
        </p>
        {!disabled && all.length > 0 && (
          <button
            type="button"
            onClick={markAllClosed}
            className="rounded border border-slate-300 px-2 py-1 text-[9px] font-semibold text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Tandai semua Closed
          </button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[10px]">
          <thead>
            <tr>
              <th className={cn(labelCellClass, 'w-[34px] text-center')}>No</th>
              <th className={cn(labelCellClass, 'text-left')}>Item</th>
              <th className={cn(labelCellClass, 'w-[110px] text-left')}>Checklist Result</th>
              {config.showRemark && <th className={cn(labelCellClass, 'text-left')}>Remark</th>}
              {config.showChecker && (
                <th className={cn(labelCellClass, 'w-[120px] text-left')}>Checker</th>
              )}
              {config.showDate && <th className={cn(labelCellClass, 'w-[110px] text-left')}>Date</th>}
              {config.showEvidence && (
                <th className={cn(labelCellClass, 'w-[130px] text-left')}>Evidence</th>
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
                    {group.title}
                  </td>
                </tr>
                {group.items.map((item) => {
                  index += 1;
                  const answer = answerOf(item.id);

                  return (
                    <tr key={item.id}>
                      <td className={cn(cellClass, 'text-center text-slate-500')}>{index}</td>
                      <td className={cellClass}>
                        {item.label}
                        {item.description && (
                          <span className="mt-0.5 block text-xs text-slate-500">
                            {item.description}
                          </span>
                        )}
                      </td>
                      <td className={cellClass}>
                        <select
                          value={answer.result ?? ''}
                          disabled={disabled}
                          aria-label={`Hasil ${item.label}`}
                          onChange={(event) =>
                            patch(item.id, {
                              result: (event.target.value || null) as ChecklistResult | null,
                            })
                          }
                          className={cn(inputClass, answer.result && RESULT_CELL[answer.result])}
                        >
                          <option value="">— Pilih —</option>
                          {CHECKLIST_RESULTS.map((result) => (
                            <option key={result} value={result}>
                              {CHECKLIST_RESULT_LABELS[result]}
                            </option>
                          ))}
                        </select>
                      </td>
                      {config.showRemark && (
                        <td className={cellClass}>
                          <input
                            value={answer.remark}
                            disabled={disabled}
                            maxLength={500}
                            placeholder="Catatan"
                            aria-label={`Catatan ${item.label}`}
                            onChange={(event) => patch(item.id, { remark: event.target.value })}
                            className={inputClass}
                          />
                        </td>
                      )}
                      {config.showChecker && (
                        <td className={cellClass}>
                          <input
                            value={answer.checker}
                            disabled={disabled}
                            maxLength={120}
                            placeholder="Nama checker"
                            aria-label={`Checker ${item.label}`}
                            onChange={(event) => patch(item.id, { checker: event.target.value })}
                            className={inputClass}
                          />
                        </td>
                      )}
                      {config.showDate && (
                        <td className={cellClass}>
                          <input
                            type="date"
                            value={answer.date}
                            disabled={disabled}
                            aria-label={`Tanggal ${item.label}`}
                            onChange={(event) => patch(item.id, { date: event.target.value })}
                            className={inputClass}
                          />
                        </td>
                      )}
                      {config.showEvidence && (
                        <td className={cellClass}>
                          <div className="space-y-1">
                            {answer.evidenceFiles.map((file) => (
                              <div key={file.id} className="flex items-center gap-1 text-[9px]">
                                {file.mimeType.startsWith('image/') ? (
                                  // eslint-disable-next-line @next/next/no-img-element -- authenticated BFF URL
                                  <img
                                    src={`/api/bff/workspace/files/${file.id}/download?inline=1`}
                                    alt={file.fileName}
                                    className="h-8 w-8 shrink-0 rounded border border-slate-200 object-cover"
                                  />
                                ) : (
                                  <Paperclip className="h-3 w-3 shrink-0 text-slate-400" aria-hidden />
                                )}
                                <a
                                  href={`/api/bff/workspace/files/${file.id}/download?inline=1`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="min-w-0 flex-1 truncate text-sky-700 hover:underline"
                                  title={file.fileName}
                                >
                                  {file.fileName}
                                </a>
                                {!disabled && (
                                  <button
                                    type="button"
                                    title="Lepas evidence"
                                    aria-label={`Lepas ${file.fileName}`}
                                    onClick={() =>
                                      patch(item.id, {
                                        evidenceFiles: answer.evidenceFiles.filter(
                                          (entry) => entry.id !== file.id,
                                        ),
                                      })
                                    }
                                    className="text-slate-400 hover:text-red-600"
                                  >
                                    <X className="h-3 w-3" aria-hidden />
                                  </button>
                                )}
                              </div>
                            ))}
                            {!disabled && (
                              <label className="inline-flex cursor-pointer items-center gap-1 rounded border border-dashed border-slate-300 px-1.5 py-1 text-[9px] font-medium text-slate-600 hover:border-sky-400 hover:text-sky-700">
                                <Upload className="h-3 w-3" aria-hidden />
                                {uploadingEvidence === item.id ? 'Mengunggah...' : 'Lampirkan'}
                                <input
                                  type="file"
                                  className="hidden"
                                  disabled={uploadingEvidence !== null}
                                  accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.png,.jpg,.jpeg,.zip"
                                  onChange={(event) => {
                                    void uploadEvidence(item.id, event.target.files?.[0]);
                                    event.currentTarget.value = '';
                                  }}
                                />
                              </label>
                            )}
                            {evidenceError[item.id] && (
                              <p className="text-[8px] text-red-600">{evidenceError[item.id]}</p>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </Fragment>
            ))}

            {all.length === 0 && (
              <tr>
                <td colSpan={columns} className={cn(cellClass, 'text-center italic text-slate-400')}>
                  Checklist belum punya item.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </SectionFrame>
  );
}

function FlowFields({
  title,
  config,
  value,
  onChange,
  disabled,
}: {
  title: string;
  config: FlowConfig;
  value: FlowContent;
  onChange: (value: FlowContent) => void;
  disabled: boolean;
}) {
  if (config.nodes.length === 0) {
    return (
      <SectionFrame title={title}>
        <p className="p-4 text-center text-[9px] italic text-slate-400">Flow belum punya node.</p>
      </SectionFrame>
    );
  }

  const maxRow = Math.max(...config.nodes.map((node) => node.row));
  const maxCol = Math.max(...config.nodes.map((node) => node.col));

  const style: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: Array.from({ length: maxCol * 2 + 1 }, (_, index) =>
      index % 2 === 0 ? 'minmax(72px, max-content)' : 'auto',
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
            <div key={node.id} style={{ gridColumn: node.col * 2 + 1, gridRow: node.row * 2 + 1 }}>
              {node.mode === 'FIXED' ? (
                <div className="rounded border border-sky-300 bg-sky-50 px-2 py-1.5 text-center text-[9px] font-bold text-sky-700">
                  {node.label}
                </div>
              ) : (
                <input
                  value={value.nodes[node.id] ?? ''}
                  disabled={disabled}
                  maxLength={60}
                  placeholder={node.label || 'isi'}
                  aria-label={`Node ${node.label || node.id}`}
                  onChange={(event) =>
                    onChange({ ...value, nodes: { ...value.nodes, [node.id]: event.target.value } })
                  }
                  className={cn(inputClass, 'text-center font-bold')}
                />
              )}
            </div>
          ))}

          {config.edges.map((edge) => {
            const from = byId.get(edge.from);
            const to = byId.get(edge.to);
            if (!from || !to) return null;

            const direction = edgeDirection(from, to);
            if (!direction) return null;

            const horizontal = direction === 'right' || direction === 'left';
            const glyph = { right: '→', left: '←', down: '↓', up: '↑' }[direction];

            return (
              <div
                key={edge.id}
                style={{
                  gridColumn: horizontal ? Math.min(from.col, to.col) * 2 + 2 : from.col * 2 + 1,
                  gridRow: horizontal ? from.row * 2 + 1 : Math.min(from.row, to.row) * 2 + 2,
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

function TableFields({
  title,
  config,
  value,
  onChange,
  disabled,
}: {
  title: string;
  config: TableConfig;
  value: TableContent;
  onChange: (value: TableContent) => void;
  disabled: boolean;
}) {
  const fill = useFill();
  const setCell = (rowIndex: number, columnIndex: number, text: string) =>
    onChange({ ...value, cells: { ...value.cells, [`${rowIndex}:${columnIndex}`]: text } });

  const setExtra = (rowIndex: number, columnIndex: number, text: string) =>
    onChange({
      ...value,
      extraRows: value.extraRows.map((row, index) =>
        index === rowIndex
          ? row.map((cell, position) => (position === columnIndex ? text : cell))
          : row,
      ),
    });

  return (
    <SectionFrame title={title}>
      <div className="overflow-x-auto p-[6px]">
        <table className="w-full border-collapse">
          {config.showHeader && (
            <thead>
              <tr>
                {config.numbered && <th className={cn(labelCellClass, 'w-[6%] text-center')}>No</th>}
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
                {config.numbered && <td className={cn(cellClass, 'text-center')}>{rowIndex + 1}</td>}
                {row.map((cell, columnIndex) => (
                  <td
                    key={config.columns[columnIndex]?.id ?? columnIndex}
                    className={cellClass}
                    style={{ textAlign: config.columns[columnIndex]?.align ?? 'left' }}
                  >
                    {cell.mode === 'FIXED' ? (
                      fill(cell.value)
                    ) : (
                      <input
                        value={value.cells[`${rowIndex}:${columnIndex}`] ?? ''}
                        disabled={disabled}
                        maxLength={2000}
                        aria-label={`Baris ${rowIndex + 1} ${config.columns[columnIndex]?.label ?? ''}`}
                        onChange={(event) => setCell(rowIndex, columnIndex, event.target.value)}
                        className={inputClass}
                      />
                    )}
                  </td>
                ))}
              </tr>
            ))}

            {value.extraRows.map((row, rowIndex) => (
              <tr key={`extra-${rowIndex}`}>
                {config.numbered && (
                  <td className={cn(cellClass, 'text-center')}>
                    {config.rows.length + rowIndex + 1}
                  </td>
                )}
                {config.columns.map((column, columnIndex) => (
                  <td key={column.id} className={cellClass}>
                    <input
                      value={row[columnIndex] ?? ''}
                      disabled={disabled}
                      maxLength={2000}
                      aria-label={`Baris tambahan ${rowIndex + 1} ${column.label}`}
                      onChange={(event) => setExtra(rowIndex, columnIndex, event.target.value)}
                      className={inputClass}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        {config.allowUserRows && !disabled && (
          <button
            type="button"
            onClick={() =>
              onChange({
                ...value,
                extraRows: [...value.extraRows, config.columns.map(() => '')],
              })
            }
            className="mt-2 rounded border border-dashed border-slate-300 px-3 py-1 text-[10px] text-slate-500 hover:border-sky-400 hover:text-sky-600"
          >
            + Tambah baris
          </button>
        )}
      </div>
    </SectionFrame>
  );
}

function ApprovalFields({
  config,
  value,
  onChange,
  disabled,
}: {
  config: ApprovalConfig;
  value: ApprovalContent;
  onChange: (value: ApprovalContent) => void;
  disabled: boolean;
}) {
  const width = `${100 / config.columns.length}%`;

  const set = (id: string, patch: Partial<{ name: string; date: string }>) => {
    // A column that has never been touched has no entry yet, so the blank is
    // supplied here rather than assumed — the stored shape always has both.
    const existing = value.columns[id] ?? { name: '', date: '' };

    onChange({
      ...value,
      columns: { ...value.columns, [id]: { ...existing, ...patch } },
    });
  };

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

              <div className="mt-auto pt-[calc(100%-44px)] space-y-1">
                {column.mode === 'FIXED' ? (
                  <p className="text-center">{column.name}</p>
                ) : (
                  <input
                    value={value.columns[column.id]?.name ?? ''}
                    disabled={disabled}
                    maxLength={80}
                    placeholder="Nama"
                    aria-label={`Nama ${column.label}`}
                    onChange={(event) => set(column.id, { name: event.target.value })}
                    className={cn(inputClass, 'text-center')}
                  />
                )}

                {column.showDate && (
                  <input
                    value={value.columns[column.id]?.date ?? ''}
                    disabled={disabled}
                    maxLength={40}
                    placeholder="Tanggal"
                    aria-label={`Tanggal ${column.label}`}
                    onChange={(event) => set(column.id, { date: event.target.value })}
                    className={cn(inputClass, 'text-center')}
                  />
                )}
              </div>
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  );
}
