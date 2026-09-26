'use client';

import {
  ArrowLeft,
  CalendarDays,
  Download,
  FileText,
  FolderTree,
  Minus,
  Plus,
  Save,
  SendHorizonal,
  Trash2,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  MANDAY_STATUS_LABELS,
  PROJECT_JOB_ROLE_LABELS,
  PROJECT_JOB_ROLE_SHORT,
  PROJECT_STAGES,
  PROJECT_STAGE_LABELS,
  saveMandayPlanSchema,
  sumEfforts,
  taskTotal,
  type MandayPlanView,
  type MandayStatus,
  type MandayTaskView,
  type ProjectJobRole,
  type ProjectStage,
} from '@dtrace/shared';
import { ApiClientError, clientFetch } from '@/lib/api/client';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { toast } from '@/components/ui/sonner';
import { DateTime } from '@/components/ui/date-time';
import { cn } from '@/lib/utils/cn';
import { dynamicRoute } from '@/lib/utils/routes';
import { STAGE_ROW } from './stage-palette';

// Stage colours live in one place so the stepper, the project table and this
// table cannot drift apart.

/** Every cell carries its own rule, so the grid reads as a grid. */
const CELL = 'border border-slate-200 dark:border-slate-700';

/** Why the save buttons are dead, said on the buttons themselves. */
const LOCKED_REASON = 'Estimasi sudah disetujui, sehingga tidak bisa diubah lagi.';

/**
 * The header band. Its rules are drawn in the header's own colour rather than
 * the body's grey, which would cut the band into boxes.
 */
const HEAD_CELL =
  'border border-white/25 px-3 py-2.5 text-xs font-semibold tracking-wide';

const STATUS_TONES: Record<MandayStatus, 'neutral' | 'info' | 'success' | 'danger'> = {
  DRAFT: 'neutral',
  SUBMITTED: 'info',
  APPROVED: 'success',
  REJECTED: 'danger',
};

type Row = MandayTaskView & { key: string; parentKey: string | null };

function toRows(plan: MandayPlanView): Row[] {
  return plan.tasks.map((task, index) => ({
    ...task,
    key: task.id || `new-${index}`,
    parentKey: task.parentId,
  }));
}

/** A row with its depth and its number, ready to render. */
export interface FlatRow {
  row: Row;
  depth: number;
  /** "1.2.1" — the stage's number, then each ancestor's place under it. */
  number: string;
  hasChildren: boolean;
}

/**
 * Depth-first, so a child always follows its parent.
 *
 * The order is not only for reading: the save payload is sent in this order,
 * and the server resolves a child's parent by the key it has already seen. A
 * breadth-first list would hand it children whose parents do not exist yet.
 */
function flatten(rows: Row[], stage: ProjectStage, stageNumber: number): FlatRow[] {
  const result: FlatRow[] = [];

  const walk = (parentKey: string | null, prefix: string, depth: number) => {
    const siblings = rows.filter((row) => row.stage === stage && row.parentKey === parentKey);

    siblings.forEach((row, index) => {
      const number = `${prefix}${index + 1}`;
      const hasChildren = rows.some((candidate) => candidate.parentKey === row.key);

      result.push({ row, depth, number, hasChildren });
      walk(row.key, `${number}.`, depth + 1);
    });
  };

  walk(null, `${stageNumber}.`, 0);
  return result;
}

/**
 * A row's own days, or the sum of everything under it.
 *
 * A parent is a roll-up, never a figure of its own: if it could carry both its
 * own effort and its children's, the two would be added together and the
 * estimate would quietly double-count the work.
 */
function effortOf(rows: Row[], row: Row, role: ProjectJobRole): number {
  const children = rows.filter((candidate) => candidate.parentKey === row.key);
  if (children.length === 0) return row.efforts[role] ?? 0;

  return children.reduce((sum, child) => sum + effortOf(rows, child, role), 0);
}

export interface MandayEditorProps {
  plan: MandayPlanView;
}

/**
 * Create Mandays: the effort estimate, stages down and job roles across.
 *
 * The whole grid is one draft in local state and saves in a single request.
 * Totals are computed from the cells on every keystroke rather than stored,
 * because a stored total is a second copy of the same fact and the two
 * eventually disagree — and the number people argue over in an approval
 * meeting is the one that has to be right.
 */
export function MandayEditor({ plan }: MandayEditorProps) {
  const router = useRouter();
  // Not on the form any more, but still on the row: held so a save round-trips
  // the stored value instead of clearing it. PIC joined them — the estimate is
  // the project team's, and a single name on top of it was never the answer to
  // who owns any one line.
  const module = plan.module ?? '';
  const pic = plan.pic ?? '';
  // The columns are the plan's own roles, fixed when it was created. There is
  // no picker any more, so this is read-only state — still sent on save so the
  // stored set survives an edit untouched.
  const [roles] = useState<ProjectJobRole[]>(plan.roles);
  const [rows, setRows] = useState<Row[]>(() => toRows(plan));
  const [baseUpdatedAt, setBaseUpdatedAt] = useState(plan.updatedAt);
  const [status, setStatus] = useState<MandayStatus>(plan.status);
  const [confirmingSubmit, setConfirmingSubmit] = useState(false);
  const [canEdit, setCanEdit] = useState(plan.canEdit);
  const [busy, setBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Submitting does not lock the grid — only an approval does, and `canEdit`
  // already carries that. An estimate is revised after it is first settled far
  // more often than it is approved.
  const editable = canEdit;

  const byStage = useMemo(
    () =>
      PROJECT_STAGES.map((stage, index) => ({
        stage,
        tasks: rows.filter((row) => row.stage === stage),
        flat: flatten(rows, stage, index + 1),
      })),
    [rows],
  );

  const grand = useMemo(() => sumEfforts(rows, roles), [rows, roles]);

  // Collapsed rather than expanded state: a stage nobody touched stays open,
  // which is what a reader filling the table in order wants.
  const [collapsed, setCollapsed] = useState<ProjectStage[]>([]);

  function toggleStage(stage: ProjectStage) {
    setCollapsed((current) =>
      current.includes(stage)
        ? current.filter((candidate) => candidate !== stage)
        : [...current, stage],
    );
  }

  function mark() {
    setError(null);
  }

  function setCell(key: string, role: ProjectJobRole, raw: string) {
    mark();
    const value = raw === '' ? undefined : Number(raw);
    setRows((current) =>
      current.map((row) => {
        if (row.key !== key) return row;
        const efforts = { ...row.efforts };
        if (value === undefined || Number.isNaN(value)) delete efforts[role];
        else efforts[role] = value;
        return { ...row, efforts };
      }),
    );
  }

  /**
   * Adds a row under a stage, or under another row when `parentKey` is given.
   *
   * A task that gains its first child hands its own days to that child. The
   * parent becomes a roll-up the moment it has children, so leaving the days
   * where they were would drop them from the total without saying so — and
   * moving them keeps the estimate's sum exactly where it was.
   */
  function addTask(stage: ProjectStage, parentKey: string | null = null) {
    mark();
    setRows((current) => {
      const parent = parentKey ? current.find((row) => row.key === parentKey) : null;
      const isFirstChild =
        parent !== null &&
        parent !== undefined &&
        !current.some((row) => row.parentKey === parentKey);

      const child: Row = {
        key: `new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        id: '',
        parentId: null,
        parentKey,
        stage,
        name: parentKey ? 'Sub-task baru' : 'Task baru',
        position: current.filter((row) => row.parentKey === parentKey).length,
        status: 'DRAFT',
        efforts: isFirstChild && parent ? { ...parent.efforts } : {},
      };

      const next = current.map((row) =>
        isFirstChild && row.key === parentKey ? { ...row, efforts: {} } : row,
      );

      // Inserted straight after its parent's subtree, so the depth-first order
      // the payload relies on is preserved without re-sorting.
      if (!parentKey) return [...next, child];

      const at = next.findIndex((row) => row.key === parentKey);
      return [...next.slice(0, at + 1), child, ...next.slice(at + 1)];
    });
  }

  /**
   * Writes the grid as it stands. `silent` is for the submit path, which says
   * its own thing when it finishes — two success banners for one click reads
   * as two things having happened.
   *
   * Returns whether it got through, so the caller can decide to carry on.
   */
  async function save({ silent = false } = {}): Promise<boolean> {
    setBusy(true);
    mark();

    const parsed = saveMandayPlanSchema.safeParse({
      module: module || null,
      pic: pic || null,
      // Kept as the creation date; there is no field for it any more.
      estimatedAt: plan.estimatedAt,
      roles,
      expectedUpdatedAt: baseUpdatedAt,
      // Flattened depth-first per stage: the server resolves each child's
      // parent from a key it has already processed, so order is part of the
      // contract rather than a presentation detail.
      tasks: byStage.flatMap(({ flat }) =>
        flat.map(({ row }) => ({
          ...(row.id ? { id: row.id } : {}),
          key: row.key,
          parentKey: row.parentKey,
          stage: row.stage,
          name: row.name,
          status: row.status,
          efforts: row.efforts,
        })),
      ),
    });

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Estimasi belum valid');
      toast.error('Ada isian yang belum benar. Periksa pesan di atas tabel.');
      setBusy(false);
      return false;
    }

    try {
      const result = await clientFetch<MandayPlanView>(
        `/workspace/projects/${plan.projectId}/mandays`,
        { method: 'PUT', body: parsed.data },
      );
      setRows(toRows(result.data));
      setBaseUpdatedAt(result.data.updatedAt);
      setStatus(result.data.status);
      setCanEdit(result.data.canEdit);
      if (!silent) toast.success('Draft tersimpan.');
      router.refresh();
      return true;
    } catch (caught) {
      const message =
        caught instanceof ApiClientError ? caught.message : 'Estimasi gagal disimpan.';
      setError(message);
      toast.error(message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  /**
   * Marks the estimate as settled and returns to the project.
   *
   * It saves first. Whatever is on screen is what the estimator believes they
   * are submitting, and posting the stored draft instead would submit an older
   * set of numbers while showing them the newer ones — the one failure this
   * screen must not have. A failed save stops here.
   *
   * Then it leaves: submitting is the end of this screen's job, and what it
   * changes — Bug Tracking, Timeline and Task Activity going live — is visible
   * on the project, not here. Staying put would leave the reader on a table
   * they have finished, hunting for what their click did.
   */
  async function submit() {
    setSubmitting(true);
    if (!(await save({ silent: true }))) {
      setSubmitting(false);
      return;
    }

    setBusy(true);
    try {
      const result = await clientFetch<MandayPlanView>(
        `/workspace/projects/${plan.projectId}/mandays/decision`,
        { method: 'POST', body: { status: 'SUBMITTED', note: null } },
      );
      setRows(toRows(result.data));
      setBaseUpdatedAt(result.data.updatedAt);
      setStatus(result.data.status);
      setCanEdit(result.data.canEdit);
      toast.success('Estimasi disubmit dan dikunci.', {
        description: 'Timeline dan Task Activity kini terbuka untuk project ini.',
      });

      // Back to the project, where Timeline and Task Activity have just
      // unlocked — that is where the reader's next step is. The confirm
      // dialog is what makes this move expected rather than abrupt; the
      // refresh is needed because the project page is server rendered and its
      // cached copy still shows those menus locked.
      router.refresh();
      router.push(dynamicRoute(`/workspace/project/${plan.projectId}`));
    } catch (caught) {
      const message =
        caught instanceof ApiClientError ? caught.message : 'Estimasi gagal di-submit.';
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
      setSubmitting(false);
    }
  }

  /**
   * Writes the grid to an `.xlsx` and hands it to the browser.
   *
   * It exports what is on screen, unsaved edits and all — the reader is
   * looking at the numbers they mean to send, and exporting the stored draft
   * instead would silently hand them an older set. Available while the plan is
   * locked too: a submitted estimate is precisely the one people circulate.
   *
   * The writer is imported here rather than at the top of the file so the zip
   * machinery only loads for somebody who actually asks for a download.
   */
  async function downloadExcel() {
    setExporting(true);

    try {
      const { exportMandayPlan } = await import('./manday-export');

      await exportMandayPlan({
        projectName: plan.projectName,
        estimatedAt: plan.createdAt,
        statusLabel: MANDAY_STATUS_LABELS[status],
        roleColumns: roles.map((role) => ({
          role,
          short: PROJECT_JOB_ROLE_SHORT[role],
          label: PROJECT_JOB_ROLE_LABELS[role],
        })),
        stages: byStage.map(({ stage, tasks, flat }, index) => {
          const totals = sumEfforts(tasks, roles);

          return {
            stage,
            number: index + 1,
            label: PROJECT_STAGE_LABELS[stage],
            byRole: totals.byRole,
            total: totals.total,
            // Collapsed stages are exported open: a fold is how this screen is
            // being read right now, not part of the estimate.
            rows: flat.map(({ row, depth, number }) => ({
              number,
              depth,
              name: row.name,
              // Rolled up here, so the file carries the same figure the cell
              // shows rather than a parent's empty own-effort.
              efforts: Object.fromEntries(
                roles.map((role) => [role, effortOf(rows, row, role)]),
              ) as MandayTaskView['efforts'],
              total: roles.reduce((sum, role) => sum + effortOf(rows, row, role), 0),
            })),
          };
        }),
        grand,
      });

      toast.success('Excel diunduh.');
    } catch {
      toast.error('Excel gagal dibuat.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-4">
      {error && <Alert tone="danger">{error}</Alert>}


      {!editable && (
        <Alert tone="info">
          <strong>Estimasi terkunci.</strong> Angka ini sudah disubmit dan menjadi dasar Timeline,
          jadi tidak bisa diubah lagi. Hubungi pengelola project bila perlu dibuka kembali.
        </Alert>
      )}

      <Card>
        <CardBody className="grid gap-4 sm:grid-cols-2 sm:divide-x sm:divide-slate-200 sm:[&>*+*]:pl-4">
          <div>
            <p className="text-xs font-medium text-slate-500">Nama Project</p>
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {plan.projectName}
            </p>
          </div>
          <div>
            <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
              <CalendarDays className="h-3.5 w-3.5" aria-hidden />
              Tanggal Estimasi
            </p>
            {/* The day the estimate was opened, not a field. It answers "when
                was this worked out", which nobody should be able to backdate. */}
            <p className="mt-0.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
              <DateTime value={plan.createdAt} />
            </p>
          </div>
        </CardBody>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader
          title="Daftar Task Mandays"
          description="Estimasi mandays berdasarkan tahapan project."
          icon={<FileText className="h-4 w-4" aria-hidden />}
          tinted
          action={
            <div className="flex items-center gap-2">
              {/* Sits with the status, not with Simpan/Submit: downloading
                  changes nothing, and grouping it with the two buttons that do
                  would make it look like a third way to commit the estimate. */}
              <Button
                variant="outline"
                size="sm"
                leftIcon={<Download className="h-4 w-4" aria-hidden />}
                loading={exporting}
                onClick={() => void downloadExcel()}
              >
                Excel
              </Button>
              <Badge tone={STATUS_TONES[status]}>{MANDAY_STATUS_LABELS[status]}</Badge>
            </div>
          }
        />

        {/*
          A ruled grid, not a list of rows. An estimate is read across as often
          as down — "how many days did QA get for Deploy" — and without a rule
          on every cell the eye loses the column halfway along.
        */}
        <div className="overflow-x-auto px-5 pb-1">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-primary text-primary-foreground">
                {/*
                  Three leading columns, not one: the stage number, the collapse
                  control and the name each get their own cell. Packing them
                  together made every sub-task name start at a different x than
                  the stage above it, so the outline stopped reading as an
                  outline. Separate cells put them on one rail.
                */}
                <th className={cn(HEAD_CELL, 'w-12 text-center')}>No</th>
                {/* One column for everything that acts on a row: the stage's
                    collapse toggle, and each task's add and delete. Keeping
                    them beside the number matters once tasks nest — the eye is
                    already at the left edge reading 1.3.1.1, and the controls
                    for that row were at the far side of nine columns. */}
                <th
                  className={cn(HEAD_CELL, editable ? 'w-20' : 'w-10')}
                  aria-label="Aksi baris"
                />
                <th className={cn(HEAD_CELL, 'text-left')}>Task Name</th>
                {roles.map((role) => (
                  <th key={role} className={cn(HEAD_CELL, 'w-28 text-center')}>
                    {PROJECT_JOB_ROLE_SHORT[role]}
                  </th>
                ))}
                <th className={cn(HEAD_CELL, 'w-20 text-center')}>Total</th>
              </tr>
            </thead>

            <tbody>
              {byStage.map(({ stage, tasks, flat }, stageIndex) => {
                const stageTotals = sumEfforts(tasks, roles);
                const isCollapsed = collapsed.includes(stage);

                return (
                  <Fragmentish key={stage}>
                    <tr className={cn('font-semibold', STAGE_ROW[stage])}>
                      <td className={cn(CELL, 'px-2 py-2 text-center tabular-nums')}>
                        {stageIndex + 1}
                      </td>
                      <td className={cn(CELL, 'px-1 py-2 text-center whitespace-nowrap')}>
                        <button
                          type="button"
                          onClick={() => toggleStage(stage)}
                          aria-expanded={!isCollapsed}
                          aria-label={`${isCollapsed ? 'Buka' : 'Tutup'} tahapan ${PROJECT_STAGE_LABELS[stage]}`}
                          className="rounded border border-slate-400/60 bg-white/70 p-0.5 text-slate-600 transition-colors hover:text-slate-900"
                        >
                          {isCollapsed ? (
                            <Plus className="h-3 w-3" aria-hidden />
                          ) : (
                            <Minus className="h-3 w-3" aria-hidden />
                          )}
                        </button>

                        {editable && (
                          <button
                            type="button"
                            onClick={() => addTask(stage)}
                            aria-label={`Tambah task di ${PROJECT_STAGE_LABELS[stage]}`}
                            title={`Tambah task di ${PROJECT_STAGE_LABELS[stage]}`}
                            className="ml-1 rounded p-1 text-slate-500 hover:bg-white/60 hover:text-slate-900"
                          >
                            <Plus className="h-3.5 w-3.5" aria-hidden />
                          </button>
                        )}
                      </td>
                      <td className={cn(CELL, 'px-3 py-2')}>{PROJECT_STAGE_LABELS[stage]}</td>
                      {roles.map((role) => (
                        <td key={role} className={cn(CELL, 'px-3 py-2 text-center')}>
                          {stageTotals.byRole[role] ?? 0}
                        </td>
                      ))}
                      <td className={cn(CELL, 'px-3 py-2 text-center')}>{stageTotals.total}</td>
                    </tr>

                    {!isCollapsed &&
                      flat.map(({ row, depth, number, hasChildren }) => (
                      <tr key={row.key} className="bg-white dark:bg-slate-900">
                        {/* The number and the toggle belong to the stage, so a
                            task leaves both columns empty and carries its own
                            index next to its name instead. */}
                        <td className={cn(CELL, 'px-2 py-1.5')} />
                        <td className={cn(CELL, 'px-1 py-1.5 text-center whitespace-nowrap')}>
                          {editable && (
                            <>
                              <button
                                type="button"
                                onClick={() => addTask(row.stage, row.key)}
                                aria-label={`Tambah sub-task di ${row.name}`}
                                title="Tambah sub-task"
                                className="rounded p-1 text-slate-400 hover:bg-sky-50 hover:text-sky-600"
                              >
                                <Plus className="h-3.5 w-3.5" aria-hidden />
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  mark();
                                  // Removing a row takes its subtree with it; the
                                  // database cascades, and leaving orphans in the
                                  // grid would show rows with no number.
                                  setRows((current) => {
                                    const doomed = new Set([row.key]);
                                    let grew = true;
                                    while (grew) {
                                      grew = false;
                                      for (const candidate of current) {
                                        if (
                                          candidate.parentKey &&
                                          doomed.has(candidate.parentKey) &&
                                          !doomed.has(candidate.key)
                                        ) {
                                          doomed.add(candidate.key);
                                          grew = true;
                                        }
                                      }
                                    }
                                    return current.filter((candidate) => !doomed.has(candidate.key));
                                  });
                                }}
                                aria-label={`Hapus ${row.name}`}
                                className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                              >
                                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                              </button>
                            </>
                          )}
                        </td>
                        <td className={cn(CELL, 'px-3 py-1.5')}>
                          <span
                            className="flex items-center gap-2"
                            style={{ paddingLeft: depth * 18 }}
                          >
                            {hasChildren ? (
                              <FolderTree className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                            ) : (
                              <FileText className="h-3.5 w-3.5 shrink-0 text-sky-500" aria-hidden />
                            )}
                            <span className="shrink-0 text-xs tabular-nums text-slate-500">
                              {number}
                            </span>
                            <input
                            value={row.name}
                            maxLength={160}
                            disabled={!editable}
                            aria-label={`Nama task ${number}`}
                            onChange={(event) => {
                              mark();
                              setRows((current) =>
                                current.map((candidate) =>
                                  candidate.key === row.key
                                    ? { ...candidate, name: event.target.value }
                                    : candidate,
                                ),
                              );
                            }}
                              className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-sm hover:border-slate-300 focus:border-sky-500 focus:outline-none disabled:opacity-70 dark:hover:border-slate-700"
                            />
                          </span>
                        </td>

                        {roles.map((role) => (
                          <td key={role} className={cn(CELL, 'px-2 py-1.5')}>
                            <input
                              type="number"
                              min={0}
                              step="any"
                              value={hasChildren ? effortOf(rows, row, role) || '' : row.efforts[role] ?? ''}
                              disabled={!editable || hasChildren}
                              placeholder="0"
                              title={
                                hasChildren
                                  ? 'Jumlah dari sub-task di bawahnya; isi angkanya di sub-task'
                                  : undefined
                              }
                              aria-label={`${PROJECT_JOB_ROLE_LABELS[role]} untuk ${row.name}`}
                              onChange={(event) => setCell(row.key, role, event.target.value)}
                              className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-center text-sm tabular-nums focus:border-sky-500 focus:outline-none disabled:bg-slate-50 disabled:opacity-70 dark:border-slate-600 dark:bg-slate-900"
                            />
                          </td>
                        ))}

                        <td className={cn(CELL, 'bg-slate-50/80 px-3 py-1.5 text-center text-sm font-medium dark:bg-slate-800/40')}>
                          {roles.reduce((sum, role) => sum + effortOf(rows, row, role), 0)}
                        </td>

                      </tr>
                    ))}
                  </Fragmentish>
                );
              })}
            </tbody>

            <tfoot>
              <tr className="bg-sky-100 font-bold text-slate-900 dark:bg-sky-950 dark:text-slate-50">
                <td className={cn(CELL, 'px-3 py-2.5 text-center')} colSpan={3}>
                  Total Mandays
                </td>
                {roles.map((role) => (
                  <td key={role} className={cn(CELL, 'px-3 py-2.5 text-center')}>
                    {grand.byRole[role] ?? 0}
                  </td>
                ))}
                <td className={cn(CELL, 'px-3 py-2.5 text-center')}>{grand.total}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/*
          The actions sit under the table, not in the card header: this form is
          taller than the viewport, and a Save button the reader has to scroll
          back up to reach is a Save button they will forget.
        */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-4 dark:border-slate-800">
          <Button
            variant="outline"
            leftIcon={<ArrowLeft className="h-4 w-4" aria-hidden />}
            onClick={() => router.push(dynamicRoute(`/workspace/project/${plan.projectId}`))}
          >
            Kembali
          </Button>

          <div className="flex flex-wrap gap-2">
            {/*
              Always on screen, disabled while the estimate is locked rather
              than hidden. A footer whose buttons come and go leaves the reader
              wondering whether they lost the ability to save or never had it;
              a disabled button with a reason answers that where they are
              looking.
            */}
            {/*
              Two actions, and the difference between them is the point.

              Saving stays here — an estimate is filled in over days, between
              meetings, and most visits end with numbers that are not final
              yet. Submitting says the breakdown is settled: it opens the
              Timeline, Task Activity and Bug Tracking, which all schedule or
              track the very rows being estimated, and hands the reader back to
              the project where those now are. Neither one waits on anybody.
              One button could only ever mean one of the two, and it used to
              mean the wrong one for the common case.
            */}
            <Button
              variant="outline"
              leftIcon={<Save className="h-4 w-4" aria-hidden />}
              loading={busy && !submitting}
              disabled={!editable || busy || submitting}
              title={editable ? undefined : LOCKED_REASON}
              onClick={() => void save()}
            >
              Simpan Draft
            </Button>
            <Button
              leftIcon={<SendHorizonal className="h-4 w-4" aria-hidden />}
              loading={submitting}
              disabled={!editable || busy || submitting}
              title={editable ? undefined : LOCKED_REASON}
              onClick={() => setConfirmingSubmit(true)}
            >
              Submit
            </Button>
          </div>
        </div>
      </Card>

      {/*
        Submitting is one-way from the estimator's side, so it asks first.
        The dialog names both consequences — the lock and what the numbers go
        on to drive — because "are you sure?" on its own tells nobody anything.
      */}
      <Dialog
        open={confirmingSubmit}
        onClose={() => setConfirmingSubmit(false)}
        size="sm"
        title="Submit estimasi?"
        description="Angka di bawah ini menjadi dasar jadwal project."
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmingSubmit(false)}>
              Batal
            </Button>
            <Button
              leftIcon={<SendHorizonal className="h-4 w-4" aria-hidden />}
              loading={submitting}
              onClick={() => {
                setConfirmingSubmit(false);
                void submit();
              }}
            >
              Ya, submit
            </Button>
          </>
        }
      >
        <ul className="space-y-2 text-sm text-slate-600">
          <li>
            Total <strong className="text-slate-900">{grand.total} mandays</strong> akan dipakai
            Timeline untuk menjadwalkan setiap task.
          </li>
          <li>
            Setelah disubmit, <strong className="text-slate-900">estimasi terkunci</strong> dan
            tidak bisa diubah lagi. Hanya pengelola project yang bisa membukanya kembali.
          </li>
          <li>Menu Timeline, Task Activity, dan Bug Tracking terbuka setelah ini.</li>
        </ul>
      </Dialog>
    </div>
  );
}

/**
 * A fragment that can carry a key inside `<tbody>`. `<>…</>` cannot take one,
 * and a wrapping element would be invalid between table rows.
 */
function Fragmentish({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
