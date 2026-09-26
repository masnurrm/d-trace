'use client';

import { Download, Eye, Paperclip, Send, Save, Upload, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Fragment, useMemo, useState } from 'react';
import {
  CHECKLIST_RESULTS,
  CHECKLIST_RESULT_LABELS,
  infoPair,
  infoSingle,
  tallyChecklist,
  type ChecklistTally,
  isPairField,
  type ChecklistAnswer,
  type ChecklistConfig,
  type ChecklistContent,
  type ChecklistResult,
  type DocumentContent,
  type DocumentDetail,
  type InfoConfig,
  type InfoContent,
  type InfoValue,
} from '@dtrace/shared';
import { ApiClientError, clientFetch } from '@/lib/api/client';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { DateTime } from '@/components/ui/date-time';
import { cn } from '@/lib/utils/cn';
import { SectionAttachments } from '@/components/document-templates/section-attachments';

/**
 * The Release Request Form, as its own screen.
 *
 * Every other document in a project is filled in through the generic editor,
 * which wraps whatever the template says in a change note, a status picker and
 * a version history. This one is not: a release request is a form with two
 * halves and two audiences — a requester fills A, a checker fills B — and it
 * ends in a decision, not in a status somebody sets by hand. So it gets the
 * layout its paper original has, and the two buttons that layout implies.
 *
 * The storage underneath is unchanged. It is still a document, still produced
 * from the RRF master template, still writing one version per save. What
 * differs is only what the person sees, which is the whole point of the
 * template owning the shape and the document owning the answers.
 */

const FIELD =
  'w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-900 transition-colors placeholder:text-slate-400 focus:border-sky-500 focus:outline-none disabled:bg-slate-50 disabled:text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100';

const RESULT_FIELD: Record<ChecklistResult, string> = {
  NO_NEED:
    'border-slate-300 bg-slate-100 font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
  NEED: 'border-rose-300 bg-rose-50 font-semibold text-rose-700 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300',
  IN_PROGRESS:
    'border-amber-300 bg-amber-50 font-semibold text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300',
  CLOSED:
    'border-emerald-300 bg-emerald-50 font-semibold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
};

const EMPTY_ANSWER: ChecklistAnswer = {
  result: null,
  remark: '',
  checker: '',
  date: '',
  evidence: '',
  evidenceFiles: [],
};

/**
 * The forms that share this screen. The layout, the storage and the submit rule
 * are one; what differs is the wording and how section B is laid out.
 *
 * `byDomain` is the security checklist's layout: its groups are domains, a
 * checker works one domain at a time, and every item needs its description in
 * view — so the groups become a column and a filter instead of header rows.
 */
const VARIANTS = {
  RELEASE: {
    subtitle: null,
    description: 'form rilis layanan IT.',
    checklistTitle: 'Release Form',
    filledBy: 'Diisi oleh IT Operation sebagai Checker',
    submitLabel: 'Submit Release Request',
    submitNote: 'Release request disubmit',
    submitted: 'Release request terkirim.',
    byDomain: false,
  },
  SECURITY: {
    subtitle: 'Security Checklist',
    description: 'security checklist rilis layanan IT.',
    checklistTitle: 'Security Checklist',
    filledBy: 'Diisi oleh IT Security sebagai Checker',
    submitLabel: 'Submit Security Checklist',
    submitNote: 'Security checklist disubmit',
    submitted: 'Security checklist terkirim.',
    byDomain: true,
  },
} as const;

export type ReleaseRequestVariant = keyof typeof VARIANTS;

export interface ReleaseRequestFormProps {
  document: DocumentDetail;
  variant?: ReleaseRequestVariant;
}

export function ReleaseRequestForm({ document, variant = 'RELEASE' }: ReleaseRequestFormProps) {
  const router = useRouter();
  const copy = VARIANTS[variant];
  const sections = document.template?.sections ?? [];
  const [domain, setDomain] = useState<string | null>(null);

  const infoSection = sections.find((section) => section.type === 'INFO');
  const checklistSection = sections.find((section) => section.type === 'CHECKLIST');

  const [content, setContent] = useState<DocumentContent>(document.content);
  const [baseUpdatedAt, setBaseUpdatedAt] = useState(document.updatedAt);
  const [status, setStatus] = useState(document.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploadingEvidence, setUploadingEvidence] = useState<string | null>(null);
  const [evidenceErrors, setEvidenceErrors] = useState<Record<string, string>>({});

  const canEdit = document.capabilities.edit;

  const info = (content[infoSection?.key ?? ''] as InfoContent | undefined) ?? { rows: {} };
  const checklist = (content[checklistSection?.key ?? ''] as ChecklistContent | undefined) ?? {
    items: {},
    itemOverrides: {},
  };

  const checklistConfig = (checklistSection?.config ?? {
    groups: [],
    filledByLabel: '',
    showRemark: true,
    showChecker: true,
    showDate: true,
    showEvidence: true,
  }) as ChecklistConfig;

  const allItems = useMemo(
    () =>
      checklistConfig.groups
        .flatMap((group) => group.items)
        .sort((left, right) => (left.position ?? 1000) - (right.position ?? 1000)),
    [checklistConfig],
  );

  const answerOf = (itemId: string) => checklist.items[itemId] ?? EMPTY_ANSWER;

  const tally = tallyChecklist(allItems.map((item) => answerOf(item.id).result));

  function touch() {
    setNotice(null);
    setError(null);
  }

  function setInfoRow(rowId: string, value: InfoValue) {
    if (!infoSection) return;
    touch();
    setContent((current) => ({
      ...current,
      [infoSection.key]: { rows: { ...info.rows, [rowId]: value } },
    }));
  }

  function patchItem(itemId: string, changes: Partial<ChecklistAnswer>) {
    if (!checklistSection) return;
    touch();
    setContent((current) => ({
      ...current,
      [checklistSection.key]: {
        items: { ...checklist.items, [itemId]: { ...answerOf(itemId), ...changes } },
        itemOverrides: checklist.itemOverrides,
      },
    }));
  }

  function markAllClosed() {
    if (!checklistSection) return;
    touch();
    setContent((current) => ({
      ...current,
      [checklistSection.key]: {
        items: Object.fromEntries(
          allItems.map((item) => [item.id, { ...answerOf(item.id), result: 'CLOSED' as const }]),
        ),
        itemOverrides: checklist.itemOverrides,
      },
    }));
  }

  async function uploadEvidence(itemId: string, file: File | undefined) {
    if (!file) return;
    const answer = answerOf(itemId);
    if (answer.evidenceFiles.length >= 10) {
      setEvidenceErrors((current) => ({ ...current, [itemId]: 'Maksimal 10 berkas per item.' }));
      return;
    }

    setUploadingEvidence(itemId);
    setEvidenceErrors((current) => ({ ...current, [itemId]: '' }));
    const form = new FormData();
    form.append('file', file);

    try {
      const result = await clientFetch<{ id: string; fileName: string; mimeType: string }>(
        `/workspace/documents/${document.id}/files`,
        { method: 'POST', body: form },
      );
      patchItem(itemId, {
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
      setEvidenceErrors((current) => ({
        ...current,
        [itemId]: caught instanceof ApiClientError ? caught.message : 'Evidence gagal diunggah.',
      }));
    } finally {
      setUploadingEvidence(null);
    }
  }

  async function persist(nextStatus: typeof status, note: string, success: string) {
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const result = await clientFetch<DocumentDetail>(
        `/workspace/documents/${document.id}/content`,
        {
          method: 'PUT',
          body: { content, note, status: nextStatus, expectedUpdatedAt: baseUpdatedAt },
        },
      );

      setContent(result.data.content);
      setBaseUpdatedAt(result.data.updatedAt);
      setStatus(result.data.status);
      setNotice(success);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : 'Form gagal disimpan.');
    } finally {
      setBusy(false);
    }
  }

  /**
   * Submitting is refused while anything is outstanding — unanswered, Need or
   * In Progress — and says how many.
   *
   * The checklist is the point of the form: a release request submitted with
   * eleven unanswered lines is a request nobody can act on, and letting it
   * through would put the decision on whoever opens it next.
   */
  async function submit() {
    if (tally.outstanding > 0) {
      setNotice(null);
      setError(
        `Masih ada ${tally.outstanding} item yang belum Closed atau No Need. Selesaikan dulu sebelum submit.`,
      );
      return;
    }
    await persist('FINAL', copy.submitNote, copy.submitted);
  }

  const detailColumns =
    (checklistConfig.showRemark ? 1 : 0) +
    (checklistConfig.showChecker ? 1 : 0) +
    (checklistConfig.showDate ? 1 : 0) +
    (checklistConfig.showEvidence ? 1 : 0);

  /** Every item with its group and its number on the form, which a filter must not renumber. */
  const numbered = useMemo(() => {
    return checklistConfig.groups
      .flatMap((group) => group.items.map((item) => ({ group, item })))
      .sort((left, right) => (left.item.position ?? 1000) - (right.item.position ?? 1000))
      .map((row, index) => ({ ...row, number: index + 1 }));
  }, [checklistConfig]);

  function renderItemRow({ group, item, number }: (typeof numbered)[number]) {
    const answer = answerOf(item.id);
    const override = checklist.itemOverrides[item.id];
    const domainValue = override?.domain ?? group.title;
    const itemValue = override?.item ?? item.label;

    return (
      <tr key={item.id}>
        <Td className="align-top text-slate-400">{number}</Td>
        {copy.byDomain && (
          <Td className="align-top">
            <span className="block whitespace-pre-line text-xs font-semibold text-slate-700 dark:text-slate-300">
              {domainValue}
            </span>
          </Td>
        )}
        <Td className="align-top">
          <span className="block whitespace-pre-line text-sm text-slate-900 dark:text-slate-100">
            {itemValue}
          </span>
        </Td>
        <Td className="align-top">
          <select
            value={answer.result ?? ''}
            disabled={!canEdit || busy}
            aria-label={`Checklist result ${item.label}`}
            onChange={(event) =>
              patchItem(item.id, {
                result: (event.target.value || null) as ChecklistResult | null,
              })
            }
            className={cn(FIELD, answer.result && RESULT_FIELD[answer.result])}
          >
            <option value="">— Pilih —</option>
            {CHECKLIST_RESULTS.map((result) => (
              <option key={result} value={result}>
                {CHECKLIST_RESULT_LABELS[result]}
              </option>
            ))}
          </select>
        </Td>
        {checklistConfig.showRemark && (
          <Td className="align-top">
            <input
              value={answer.remark}
              disabled={!canEdit || busy}
              maxLength={500}
              placeholder="Catatan"
              aria-label={`Remark ${item.label}`}
              onChange={(event) => patchItem(item.id, { remark: event.target.value })}
              className={FIELD}
            />
          </Td>
        )}
        {checklistConfig.showChecker && (
          <Td className="align-top">
            <input
              value={answer.checker}
              disabled={!canEdit || busy}
              maxLength={120}
              placeholder="Nama checker"
              aria-label={`Checker ${item.label}`}
              onChange={(event) => patchItem(item.id, { checker: event.target.value })}
              className={FIELD}
            />
          </Td>
        )}
        {checklistConfig.showDate && (
          <Td className="align-top">
            <input
              type="date"
              value={answer.date}
              disabled={!canEdit || busy}
              aria-label={`Date ${item.label}`}
              onChange={(event) => patchItem(item.id, { date: event.target.value })}
              className={FIELD}
            />
          </Td>
        )}
        {checklistConfig.showEvidence && (
          <Td className="min-w-[230px] align-top">
            <div className="space-y-1.5">
              {answer.evidenceFiles.map((file) => {
                const inline =
                  file.mimeType === 'application/pdf' || file.mimeType.startsWith('image/');
                const baseUrl = `/api/bff/workspace/files/${file.id}/download`;
                return (
                  <div
                    key={file.id}
                    className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-1 dark:border-slate-700 dark:bg-slate-800"
                  >
                    {file.mimeType.startsWith('image/') ? (
                      // eslint-disable-next-line @next/next/no-img-element -- authenticated BFF URL
                      <img
                        src={`${baseUrl}?inline=1`}
                        alt={file.fileName}
                        className="h-8 w-8 shrink-0 rounded object-cover"
                      />
                    ) : (
                      <Paperclip className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                    )}
                    <span className="min-w-0 flex-1 truncate text-[11px]" title={file.fileName}>
                      {file.fileName}
                    </span>
                    {inline && (
                      <a
                        href={`${baseUrl}?inline=1`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Lihat evidence"
                        aria-label={`Lihat ${file.fileName}`}
                        className="rounded p-1 text-sky-700 hover:bg-sky-100"
                      >
                        <Eye className="h-3.5 w-3.5" aria-hidden />
                      </a>
                    )}
                    <a
                      href={baseUrl}
                      download
                      title="Download evidence"
                      aria-label={`Download ${file.fileName}`}
                      className="rounded p-1 text-slate-600 hover:bg-slate-200"
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden />
                    </a>
                    {canEdit && !busy && (
                      <button
                        type="button"
                        title="Lepas evidence"
                        aria-label={`Lepas ${file.fileName}`}
                        onClick={() =>
                          patchItem(item.id, {
                            evidenceFiles: answer.evidenceFiles.filter(
                              (entry) => entry.id !== file.id,
                            ),
                          })
                        }
                        className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      >
                        <X className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    )}
                  </div>
                );
              })}
              {canEdit && (
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-dashed border-slate-300 px-2 py-1.5 text-[11px] font-medium text-slate-600 hover:border-sky-400 hover:text-sky-700 dark:border-slate-700">
                  <Upload className="h-3.5 w-3.5" aria-hidden />
                  {uploadingEvidence === item.id ? 'Mengunggah...' : 'Lampirkan evidence'}
                  <input
                    type="file"
                    className="hidden"
                    disabled={busy || uploadingEvidence !== null}
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.png,.jpg,.jpeg,.zip"
                    onChange={(event) => {
                      void uploadEvidence(item.id, event.target.files?.[0]);
                      event.currentTarget.value = '';
                    }}
                  />
                </label>
              )}
              {evidenceErrors[item.id] && (
                <p className="text-[10px] text-red-600">{evidenceErrors[item.id]}</p>
              )}
            </div>
          </Td>
        )}
      </tr>
    );
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
            Release Request Form
            {copy.subtitle && (
              <small className="mt-0.5 block text-sm font-semibold text-primary">
                {copy.subtitle}
              </small>
            )}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {document.breadcrumb} — {copy.description}
          </p>
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Document Date &amp; Time:{' '}
          <b className="font-semibold text-slate-900 dark:text-slate-100">
            <DateTime value={document.updatedAt} />
          </b>
        </p>
      </header>

      {error && <Alert tone="danger">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}
      {!canEdit && (
        <Alert tone="info">Anda hanya dapat melihat form ini, tidak dapat mengubahnya.</Alert>
      )}

      {/* A — the requester's half */}
      <Card>
        <CardBody className="space-y-4">
          <div>
            <h2 className="flex items-center gap-2 text-[15px] font-semibold text-slate-900 dark:text-slate-50">
              <Badge tone="info">A</Badge>
              General Information
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Diisi oleh IT Development sebagai Requester
            </p>
          </div>

          {infoSection ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {(infoSection.config as InfoConfig).rows.map((row) => (
                <div
                  key={row.id}
                  className={cn(row.span === 'full' && 'sm:col-span-2 lg:col-span-3')}
                >
                  <label
                    htmlFor={`rrf-${row.id}`}
                    className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-200"
                  >
                    {row.label}
                    {row.hint && (
                      <span className="ml-1 font-normal text-slate-400">({row.hint})</span>
                    )}
                  </label>
                  <InfoInput
                    row={row}
                    value={info.rows[row.id]}
                    disabled={!canEdit || busy}
                    onChange={(value) => setInfoRow(row.id, value)}
                  />
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm italic text-slate-400">Template belum punya bagian informasi.</p>
          )}
          <SectionAttachments attachments={infoSection?.attachments ?? []} />
        </CardBody>
      </Card>

      {/* B — the checker's half */}
      <Card>
        <CardBody className="space-y-4">
          <div>
            <h2 className="flex items-center gap-2 text-[15px] font-semibold text-slate-900 dark:text-slate-50">
              <Badge tone="info">B</Badge>
              {copy.checklistTitle}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {checklistConfig.filledByLabel || copy.filledBy}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <div className="h-2 min-w-[180px] flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
              <div
                className="h-full bg-emerald-500 transition-[width] duration-200"
                style={{ width: `${tally.settledPercent}%` }}
              />
            </div>
            <ChecklistCounts tally={tally} className="text-xs" />
            {canEdit && allItems.length > 0 && (
              <Button variant="outline" size="sm" onClick={markAllClosed} disabled={busy}>
                Tandai semua Closed
              </Button>
            )}
          </div>

          {copy.byDomain && checklistConfig.groups.length > 1 && (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter domain">
              <DomainChip active={domain === null} onClick={() => setDomain(null)}>
                Semua ({allItems.length})
              </DomainChip>
              {checklistConfig.groups.map((group) => (
                <DomainChip
                  key={group.id}
                  active={domain === group.id}
                  onClick={() => setDomain(group.id)}
                >
                  {group.title} ({group.items.length})
                </DomainChip>
              ))}
            </div>
          )}

          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
            <table
              className={cn(
                'w-full border-collapse text-sm',
                copy.byDomain ? 'min-w-[1100px]' : 'min-w-[900px]',
              )}
            >
              <thead>
                <tr className="bg-slate-100 dark:bg-slate-800">
                  <Th className="w-[46px]">No</Th>
                  {copy.byDomain && <Th className="w-[150px]">Domain</Th>}
                  <Th>Item</Th>
                  <Th className="w-[140px]">Checklist Result</Th>
                  {checklistConfig.showRemark && <Th>Remark</Th>}
                  {checklistConfig.showChecker && <Th className="w-[150px]">Checker</Th>}
                  {checklistConfig.showDate && <Th className="w-[150px]">Date</Th>}
                  {checklistConfig.showEvidence && <Th className="w-[170px]">Evidence</Th>}
                </tr>
              </thead>
              <tbody>
                {copy.byDomain
                  ? numbered
                      .filter((row) => domain === null || row.group.id === domain)
                      .map(renderItemRow)
                  : checklistConfig.groups.map((group) => (
                      <Fragment key={group.id}>
                        <tr>
                          <td
                            colSpan={3 + detailColumns}
                            className="border-t border-slate-200 bg-sky-50 px-3 py-2 text-[13px] font-bold text-sky-700 dark:border-slate-800 dark:bg-sky-950 dark:text-sky-300"
                          >
                            {group.title}
                          </td>
                        </tr>
                        {numbered.filter((row) => row.group.id === group.id).map(renderItemRow)}
                      </Fragment>
                    ))}
              </tbody>
            </table>
          </div>
          <SectionAttachments attachments={checklistSection?.attachments ?? []} />
        </CardBody>
      </Card>

      {canEdit && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            variant="outline"
            loading={busy}
            leftIcon={<Save className="h-4 w-4" aria-hidden />}
            onClick={() => persist('DRAFT', 'Simpan draft', 'Draft tersimpan.')}
          >
            Simpan Draft
          </Button>
          <Button
            loading={busy}
            leftIcon={<Send className="h-4 w-4" aria-hidden />}
            onClick={submit}
          >
            {copy.submitLabel}
          </Button>
        </div>
      )}

      {status === 'FINAL' && (
        <p className="text-right text-xs text-slate-500 dark:text-slate-400">
          Form ini sudah disubmit. Menyimpan draft lagi akan mengembalikannya ke status Draft.
        </p>
      )}
    </div>
  );
}

/** The per-status counts above a checklist, in the order the dropdown lists them. */
export function ChecklistCounts({ tally, className }: { tally: ChecklistTally; className?: string }) {
  const parts: [string, number][] = [
    ...CHECKLIST_RESULTS.map((result): [string, number] => [
      CHECKLIST_RESULT_LABELS[result],
      tally.counts[result],
    ]),
    ['Belum diisi', tally.unanswered],
  ];

  return (
    <p className={cn('text-slate-500 dark:text-slate-400', className)}>
      {parts.map(([label, count], index) => (
        <Fragment key={label}>
          {index > 0 && ' · '}
          <b className="text-slate-900 dark:text-slate-100">{count}</b> {label}
        </Fragment>
      ))}
    </p>
  );
}

function DomainChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1 text-xs transition-colors',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-background text-foreground hover:bg-muted',
      )}
    >
      {children}
    </button>
  );
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        'px-3 py-2 text-left text-xs font-semibold whitespace-nowrap text-slate-600 dark:text-slate-300',
        className,
      )}
    >
      {children}
    </th>
  );
}

function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <td
      className={cn(
        'border-t border-slate-200 px-3 py-1.5 align-middle dark:border-slate-800',
        className,
      )}
    >
      {children}
    </td>
  );
}

/** The control one General Information row asks for, in form dress. */
function InfoInput({
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
  const id = `rrf-${row.id}`;

  if (row.mode === 'FIXED') {
    return (
      <p className="py-2 text-sm font-medium text-slate-900 dark:text-slate-100">
        {row.value || '—'}
      </p>
    );
  }

  if (isPairField(row.field)) {
    const [start, end] = infoPair(value);
    const type =
      row.field === 'DATETIME_RANGE'
        ? 'datetime-local'
        : row.field === 'DATE_RANGE'
          ? 'date'
          : 'number';
    const [firstUnit, secondUnit] = row.units;
    const separator = row.field === 'DURATION' ? null : 's/d';

    return (
      <div className="flex items-center gap-2">
        <input
          id={id}
          type={type}
          min={type === 'number' ? 0 : undefined}
          value={start}
          disabled={disabled}
          aria-label={`${row.label} — ${firstUnit ?? 'mulai'}`}
          onChange={(event) => onChange([event.target.value, end])}
          className={FIELD}
        />
        {(separator ?? firstUnit) && (
          <span className="shrink-0 text-xs text-slate-500">{separator ?? firstUnit}</span>
        )}
        <input
          type={type}
          min={type === 'number' ? 0 : undefined}
          value={end}
          disabled={disabled}
          aria-label={`${row.label} — ${secondUnit ?? 'selesai'}`}
          onChange={(event) => onChange([start, event.target.value])}
          className={FIELD}
        />
        {separator === null && secondUnit && (
          <span className="shrink-0 text-xs text-slate-500">{secondUnit}</span>
        )}
      </div>
    );
  }

  const single = infoSingle(value);

  switch (row.field) {
    case 'SELECT':
      return (
        <select
          id={id}
          value={single}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className={FIELD}
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
          id={id}
          rows={3}
          maxLength={2000}
          value={single}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className={FIELD}
        />
      );
    case 'NUMBER':
      return (
        <input
          id={id}
          type="number"
          min={0}
          value={single}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className={FIELD}
        />
      );
    case 'DATE':
    case 'DATETIME':
      return (
        <input
          id={id}
          type={row.field === 'DATETIME' ? 'datetime-local' : 'date'}
          value={single}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className={FIELD}
        />
      );
    default:
      return (
        <input
          id={id}
          maxLength={2000}
          value={single}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className={FIELD}
        />
      );
  }
}
