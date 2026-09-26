'use client';

import { useMutation } from '@tanstack/react-query';
import { Check, Copy, Download, ListChecks, Pencil, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  DEV_STATUSES,
  DEV_STATUS_LABELS,
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TEST_STATUSES,
  TEST_STATUS_LABELS,
  isTaskComplete,
  isTaskNotStarted,
  saveProjectTaskSchema,
  type DevStatus,
  type ProjectTaskView,
  type SaveProjectTaskInput,
  type TaskPriority,
  type TestStatus,
} from '@dtrace/shared';
import { ApiClientError, clientFetch } from '@/lib/api/client';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { SelectControl, TextField } from '@/components/ui/field';
import { cn } from '@/lib/utils/cn';

/** Colour per status, matching the legend under the table. */
const DEV_TONE: Record<DevStatus, string> = {
  UNREADY: 'bg-slate-100 text-slate-700 ring-slate-200',
  WAITING_CONFIRM_USER: 'bg-amber-50 text-amber-800 ring-amber-200',
  READY: 'bg-blue-50 text-blue-700 ring-blue-200',
  IN_PROGRESS: 'bg-violet-50 text-violet-700 ring-violet-200',
  CLOSED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
};

const TEST_TONE: Record<TestStatus, string> = {
  REOPENED: 'bg-amber-50 text-amber-800 ring-amber-200',
  WAITING_DEVELOPMENT: 'bg-slate-100 text-slate-700 ring-slate-200',
  READY: 'bg-blue-50 text-blue-700 ring-blue-200',
  IN_PROGRESS: 'bg-violet-50 text-violet-700 ring-violet-200',
  CLOSED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
};

const PRIORITY_TONE: Record<TaskPriority, string> = {
  HIGH: 'bg-red-50 text-red-700 ring-red-200',
  MEDIUM: 'bg-amber-50 text-amber-800 ring-amber-200',
  LOW: 'bg-blue-50 text-blue-700 ring-blue-200',
};

const shortDate = (iso: string | null) =>
  iso
    ? new Date(iso)
        .toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: '2-digit' })
        .replace(/ /g, '-')
    : '—';

const ALL = '';

/**
 * The row being added, as opposed to a row being changed.
 *
 * A real id can never be this, so one `editing` value covers both cases and the
 * table never has to ask which of two modes it is in.
 */
const NEW_ROW = 'new';

/** The table's own input: sized for a dense grid, not for a form. */
const CELL_INPUT =
  'w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 outline-none focus:border-sky-500 disabled:bg-slate-50';

const toInput = (iso: string | null) => (iso ? iso.slice(0, 10) : '');
const fromInput = (value: string) => (value ? `${value}T00:00:00.000Z` : null);

/**
 * The row under the cursor, held as strings.
 *
 * Strings rather than the view's own types because a half-typed date is a
 * string and only a whole one is a date — the same split the settings form
 * makes. `toBody()` is the one place it converts back.
 */
interface Draft {
  module: string;
  category: string;
  description: string;
  priority: TaskPriority;
  assigneeId: string;
  devPlanStart: string;
  devPlanEnd: string;
  devActualStart: string;
  devActualEnd: string;
  devCompletion: string;
  devStatus: DevStatus;
  testPlanStart: string;
  testPlanEnd: string;
  testActualStart: string;
  testActualEnd: string;
  testCompletion: string;
  testStatus: TestStatus;
  remark: string;
}

function toDraft(task: ProjectTaskView | null): Draft {
  return {
    module: task?.module ?? '',
    category: task?.category ?? '',
    description: task?.description ?? '',
    priority: task?.priority ?? 'MEDIUM',
    assigneeId: task?.assigneeId ?? '',
    devPlanStart: toInput(task?.devPlanStart ?? null),
    devPlanEnd: toInput(task?.devPlanEnd ?? null),
    devActualStart: toInput(task?.devActualStart ?? null),
    devActualEnd: toInput(task?.devActualEnd ?? null),
    devCompletion: String(task?.devCompletion ?? 0),
    devStatus: task?.devStatus ?? 'UNREADY',
    testPlanStart: toInput(task?.testPlanStart ?? null),
    testPlanEnd: toInput(task?.testPlanEnd ?? null),
    testActualStart: toInput(task?.testActualStart ?? null),
    testActualEnd: toInput(task?.testActualEnd ?? null),
    testCompletion: String(task?.testCompletion ?? 0),
    testStatus: task?.testStatus ?? 'WAITING_DEVELOPMENT',
    remark: task?.remark ?? '',
  };
}

function toBody(draft: Draft) {
  return {
    module: draft.module.trim(),
    category: draft.category.trim() || null,
    description: draft.description.trim(),
    priority: draft.priority,
    assigneeId: draft.assigneeId || null,
    devPlanStart: fromInput(draft.devPlanStart),
    devPlanEnd: fromInput(draft.devPlanEnd),
    devActualStart: fromInput(draft.devActualStart),
    devActualEnd: fromInput(draft.devActualEnd),
    devCompletion: Number(draft.devCompletion) || 0,
    devStatus: draft.devStatus,
    testPlanStart: fromInput(draft.testPlanStart),
    testPlanEnd: fromInput(draft.testPlanEnd),
    testActualStart: fromInput(draft.testActualStart),
    testActualEnd: fromInput(draft.testActualEnd),
    testCompletion: Number(draft.testCompletion) || 0,
    testStatus: draft.testStatus,
    remark: draft.remark.trim() || null,
  };
}

export interface TaskActivityProps {
  projectId: string;
  projectName: string;
  tasks: ProjectTaskView[];
  members: { userId: string; name: string }[];
  canEdit: boolean;
}

/**
 * The module task list: every task followed through development and testing.
 *
 * The whole list is loaded at once — a project has tens of tasks, not
 * thousands — which is what lets the search, the four filters, the totals and
 * the export all agree with each other without another round trip. A paginated
 * version of this screen would export the page you happened to be on, and call
 * it an export.
 *
 * Editing happens **in the row**. A task carries eighteen fields and that was
 * the argument for a dialog, but the fields are only readable next to the
 * neighbouring rows: a plan date means little except against the one above it,
 * and a dialog covers exactly the rows you are comparing against. One row at a
 * time is editable, because two half-finished rows and one Save button is a
 * question about which of them it saves.
 */
export function TaskActivity({
  projectId,
  projectName,
  tasks,
  members,
  canEdit,
}: TaskActivityProps) {
  const router = useRouter();

  const [search, setSearch] = useState('');
  const [module, setModule] = useState(ALL);
  const [category, setCategory] = useState(ALL);
  const [devStatus, setDevStatus] = useState(ALL);
  const [testStatus, setTestStatus] = useState(ALL);
  const [priority, setPriority] = useState(ALL);

  /** The id being edited, `NEW_ROW` while adding, or null when nothing is. */
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  // Filter options come from the data, not a fixed list: modules are free text
  // and differ per project, so a hard-coded dropdown would be wrong everywhere.
  const modules = useMemo(
    () => [...new Set(tasks.map((task) => task.module))].sort((a, b) => a.localeCompare(b)),
    [tasks],
  );
  const categories = useMemo(
    () =>
      [...new Set(tasks.map((task) => task.category).filter(Boolean as unknown as (v: string | null) => v is string))].sort(
        (a, b) => a.localeCompare(b),
      ),
    [tasks],
  );

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return tasks.filter((task) => {
      if (module && task.module !== module) return false;
      if (category && task.category !== category) return false;
      if (devStatus && task.devStatus !== devStatus) return false;
      if (testStatus && task.testStatus !== testStatus) return false;
      if (priority && task.priority !== priority) return false;
      if (!needle) return true;

      return [task.module, task.category ?? '', task.description, task.assigneeName ?? '', task.remark ?? '']
        .join(' ')
        .toLowerCase()
        .includes(needle);
    });
  }, [tasks, search, module, category, devStatus, testStatus, priority]);

  const completed = tasks.filter(isTaskComplete).length;
  const notStarted = tasks.filter(isTaskNotStarted).length;
  const inProgress = tasks.length - completed - notStarted;
  const progress = tasks.length === 0 ? 0 : Math.round((completed / tasks.length) * 100);

  function closeEditor() {
    setEditing(null);
    setDraft(null);
    save.reset();
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!draft) return;

      const body = toBody(draft);

      // Parsed against the same schema the API validates with, so a missing
      // module is answered here rather than as a 400 the row cannot explain.
      const parsed = saveProjectTaskSchema.safeParse(body);
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message ?? 'Task belum valid');
      }

      return editing === NEW_ROW
        ? clientFetch(`/workspace/projects/${projectId}/tasks`, { method: 'POST', body: parsed.data })
        : clientFetch(`/workspace/tasks/${editing}`, { method: 'PUT', body: parsed.data });
    },
    onSuccess: () => {
      closeEditor();
      router.refresh();
    },
  });

  const duplicate = useMutation({
    mutationFn: (id: string) =>
      clientFetch(`/workspace/tasks/${id}/duplicate`, { method: 'POST' }),
    onSuccess: () => router.refresh(),
  });

  const remove = useMutation({
    mutationFn: (id: string) => clientFetch(`/workspace/tasks/${id}`, { method: 'DELETE' }),
    onSuccess: () => router.refresh(),
  });

  const error =
    messageOf(save.error, 'Task gagal disimpan.') ??
    messageOf(duplicate.error, 'Task gagal diduplikat.') ??
    messageOf(remove.error, 'Task gagal dihapus.');

  function startEdit(task: ProjectTaskView) {
    save.reset();
    setDraft(toDraft(task));
    setEditing(task.id);
  }

  function startCreate() {
    save.reset();
    setDraft(toDraft(null));
    setEditing(NEW_ROW);
  }

  function reset() {
    setSearch('');
    setModule(ALL);
    setCategory(ALL);
    setDevStatus(ALL);
    setTestStatus(ALL);
    setPriority(ALL);
  }

  const [exporting, setExporting] = useState(false);

  /**
   * Exports what is on screen, not what fits on a page — the filters in force
   * decide the rows, and are written into the file so it says which slice it is.
   */
  async function exportExcel() {
    const filters = [
      search.trim() && `Cari "${search.trim()}"`,
      module && `Modul: ${module}`,
      category && `Category: ${category}`,
      devStatus && `Status Dev: ${DEV_STATUS_LABELS[devStatus as DevStatus]}`,
      testStatus && `Status Test: ${TEST_STATUS_LABELS[testStatus as TestStatus]}`,
      priority && `Priority: ${TASK_PRIORITY_LABELS[priority as TaskPriority]}`,
    ].filter((value): value is string => Boolean(value));

    setExporting(true);
    try {
      const { exportTasksToExcel } = await import('./task-activity-export');
      await exportTasksToExcel(visible, { projectName, filters });
    } finally {
      setExporting(false);
    }
  }

  const editorProps = {
    members,
    saving: save.isPending,
    onChange: (next: Draft) => setDraft(next),
    onSave: () => save.mutate(),
    onCancel: closeEditor,
  };

  return (
    <div className="space-y-4">
      {error && <Alert tone="danger">{error}</Alert>}

      <Card>
        <CardHeader
          title="Module Task List"
          description={`${projectName} — progres tiap task melewati development dan testing.`}
          icon={<ListChecks className="h-4 w-4" aria-hidden />}
          tinted
          action={
            <div className="flex flex-wrap items-center gap-3">
              <div className="w-48">
                <p className="mb-1 text-xs text-slate-500">
                  Overall Task Progress <span className="font-semibold text-slate-800">{progress}%</span>
                </p>
                <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                  <div className="h-full rounded-full bg-sky-600" style={{ width: `${progress}%` }} />
                </div>
              </div>

              <Stat label="Total Task" value={tasks.length} />
              <Stat label="In Progress" value={inProgress} tone="text-violet-700" />
              <Stat label="Completed" value={completed} tone="text-emerald-700" />
              <Stat label="Not Started" value={notStarted} tone="text-slate-500" />

              {canEdit && (
                <Button
                  leftIcon={<Plus className="h-4 w-4" aria-hidden />}
                  onClick={startCreate}
                  // One row at a time: the new row would otherwise appear while
                  // another one is half-edited, with one Save button between them.
                  disabled={editing !== null}
                >
                  Add Task
                </Button>
              )}
              <Button
                variant="outline"
                leftIcon={<Download className="h-4 w-4" aria-hidden />}
                loading={exporting}
                onClick={() => void exportExcel()}
                disabled={visible.length === 0 || exporting}
              >
                Export Excel
              </Button>
            </div>
          }
        />

        <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 px-5 py-4">
          <TextField
            label="Cari"
            name="task-search"
            className="w-64"
            placeholder="Modul, task, atau assignee"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Filter label="Modul" value={module} onChange={setModule} placeholder="Semua modul"
            options={modules.map((value) => ({ value, label: value }))} />
          <Filter label="Category" value={category} onChange={setCategory} placeholder="Semua category"
            options={categories.map((value) => ({ value, label: value }))} />
          <Filter label="Status Dev" value={devStatus} onChange={setDevStatus} placeholder="Semua status dev"
            options={DEV_STATUSES.map((value) => ({ value, label: DEV_STATUS_LABELS[value] }))} />
          <Filter label="Status Test" value={testStatus} onChange={setTestStatus} placeholder="Semua status test"
            options={TEST_STATUSES.map((value) => ({ value, label: TEST_STATUS_LABELS[value] }))} />
          <Filter label="Priority" value={priority} onChange={setPriority} placeholder="Semua priority"
            options={TASK_PRIORITIES.map((value) => ({ value, label: TASK_PRIORITY_LABELS[value] }))} />
          <Button
            variant="outline"
            leftIcon={<RotateCcw className="h-4 w-4" aria-hidden />}
            onClick={reset}
          >
            Reset
          </Button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              {/* Two header rows: the six date-and-status columns repeat for
                  each half, and only a spanning header says which half. */}
              <tr className="border-b border-slate-200 text-xs font-semibold text-slate-700">
                <th colSpan={6} className="bg-slate-50 px-3 py-2" />
                <th colSpan={6} className="border-x border-slate-200 bg-blue-50 px-3 py-2 text-center">
                  Development
                </th>
                <th colSpan={6} className="bg-emerald-50 px-3 py-2 text-center">
                  Testing
                </th>
                <th colSpan={2} className="bg-slate-50 px-3 py-2" />
              </tr>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700">
                <th className="px-3 py-2 text-left">No</th>
                <th className="px-3 py-2 text-left">Modul</th>
                <th className="px-3 py-2 text-left">Category</th>
                <th className="px-3 py-2 text-left">Task Description</th>
                <th className="px-3 py-2 text-left">
                  {/* A table ignores min-width on a cell; a sized block inside it holds the column. */}
                  <div className="w-36">Priority</div>
                </th>
                <th className="whitespace-nowrap px-3 py-2 text-left">
                  <div className="w-56">Assigned to</div>
                </th>
                {(['Plan Start', 'Plan End', 'Actual Start', 'Actual End', '% Done', 'Status'] as const).map(
                  (label) => (
                    <th key={`dev-${label}`} className="whitespace-nowrap px-3 py-2 text-left">
                      {label}
                    </th>
                  ),
                )}
                {(['Plan Start', 'Plan End', 'Actual Start', 'Actual End', '% Done', 'Status'] as const).map(
                  (label) => (
                    <th key={`test-${label}`} className="whitespace-nowrap px-3 py-2 text-left">
                      {label}
                    </th>
                  ),
                )}
                <th className="px-3 py-2 text-left">Remark Dev/Test</th>
                <th className="px-3 py-2 text-right">Action</th>
              </tr>
            </thead>

            <tbody>
              {visible.length === 0 && editing !== NEW_ROW && (
                <tr>
                  <td colSpan={20} className="px-5 py-10 text-center text-slate-500">
                    {tasks.length === 0
                      ? 'Belum ada task di project ini.'
                      : 'Tidak ada task yang cocok dengan filter ini.'}
                  </td>
                </tr>
              )}

              {visible.map((task, index) => {
                if (editing === task.id && draft) {
                  return <EditRow key={task.id} number={index + 1} {...editorProps} draft={draft} />;
                }

                const done = isTaskComplete(task);

                return (
                  <tr
                    key={task.id}
                    className={cn(
                      'border-b border-slate-100 align-top',
                      // A finished task stays readable but stops competing for
                      // attention with the ones still moving.
                      done && 'text-slate-400 line-through',
                      // Everything else recedes while one row is being edited,
                      // so the row with the cursor in it is obvious.
                      editing !== null && 'opacity-60',
                    )}
                  >
                    <td className="px-3 py-2">{index + 1}</td>
                    <td className="px-3 py-2">{task.module}</td>
                    <td className="px-3 py-2">{task.category ?? '—'}</td>
                    <td className="max-w-64 px-3 py-2">{task.description}</td>
                    <td className="px-3 py-2 no-underline">
                      <Pill className={PRIORITY_TONE[task.priority]}>
                        {TASK_PRIORITY_LABELS[task.priority]}
                      </Pill>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">{task.assigneeName ?? '—'}</td>

                    <DateCells
                      values={[task.devPlanStart, task.devPlanEnd, task.devActualStart, task.devActualEnd]}
                    />
                    <td className="px-3 py-2">{task.devCompletion}%</td>
                    <td className="px-3 py-2 no-underline">
                      <Pill className={DEV_TONE[task.devStatus]}>{DEV_STATUS_LABELS[task.devStatus]}</Pill>
                    </td>

                    <DateCells
                      values={[task.testPlanStart, task.testPlanEnd, task.testActualStart, task.testActualEnd]}
                    />
                    <td className="px-3 py-2">{task.testCompletion}%</td>
                    <td className="px-3 py-2 no-underline">
                      <Pill className={TEST_TONE[task.testStatus]}>{TEST_STATUS_LABELS[task.testStatus]}</Pill>
                    </td>

                    <td className="max-w-56 px-3 py-2 text-xs">{task.remark ?? '—'}</td>

                    <td className="px-3 py-2 no-underline">
                      <div className="flex justify-end gap-1">
                        {canEdit && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Ubah ${task.description}`}
                              title="Ubah baris ini"
                              disabled={editing !== null}
                              onClick={() => startEdit(task)}
                            >
                              <Pencil className="h-3.5 w-3.5" aria-hidden />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Duplikat ${task.description}`}
                              title="Duplikat ke baris di bawahnya"
                              disabled={editing !== null}
                              loading={duplicate.isPending && duplicate.variables === task.id}
                              onClick={() => duplicate.mutate(task.id)}
                            >
                              <Copy className="h-3.5 w-3.5" aria-hidden />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Hapus ${task.description}`}
                              title="Hapus baris ini"
                              disabled={editing !== null}
                              loading={remove.isPending && remove.variables === task.id}
                              onClick={() => remove.mutate(task.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5 text-red-500" aria-hidden />
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}

              {/* The new row sits at the end, outside the filter: a row that
                  vanished as you typed its module would be unaddable under any
                  filter that excludes it. */}
              {editing === NEW_ROW && draft && (
                <EditRow number={tasks.length + 1} {...editorProps} draft={draft} />
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-3 text-xs text-slate-500">
          <span>
            Menampilkan {visible.length} dari {tasks.length} task
          </span>
          <div className="flex flex-wrap items-center gap-3">
            <Legend className="bg-slate-300" label="Belum mulai" />
            <Legend className="bg-violet-500" label="Berjalan" />
            <Legend className="bg-emerald-500" label="Closed" />
            <Legend className="bg-amber-500" label="Re-Opened / menunggu" />
            <Legend className="bg-blue-500" label="Siap" />
          </div>
        </div>
      </Card>
    </div>
  );
}

/**
 * One row, open for editing: the same twenty columns, with a control in each.
 *
 * The action column carries Save and Cancel while it is open, in place of
 * edit/duplicate/delete — the three of those act on a stored row, and this row
 * is not stored yet.
 */
function EditRow({
  number,
  draft,
  members,
  saving,
  onChange,
  onSave,
  onCancel,
}: {
  number: number;
  draft: Draft;
  members: { userId: string; name: string }[];
  saving: boolean;
  onChange: (next: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    onChange({ ...draft, [key]: value });

  return (
    <tr className="border-b border-slate-200 bg-sky-50/60 align-top">
      <td className="px-3 py-2 text-slate-500">{number}</td>

      <td className="px-2 py-1.5">
        <input
          className={cn(CELL_INPUT, 'min-w-28')}
          aria-label="Modul"
          placeholder="Modul"
          value={draft.module}
          maxLength={80}
          onChange={(event) => set('module', event.target.value)}
        />
      </td>
      <td className="px-2 py-1.5">
        <input
          className={cn(CELL_INPUT, 'min-w-24')}
          aria-label="Category"
          placeholder="Category"
          value={draft.category}
          maxLength={60}
          onChange={(event) => set('category', event.target.value)}
        />
      </td>
      <td className="px-2 py-1.5">
        <input
          className={cn(CELL_INPUT, 'min-w-56')}
          aria-label="Task Description"
          placeholder="Deskripsi task"
          value={draft.description}
          maxLength={500}
          onChange={(event) => set('description', event.target.value)}
        />
      </td>
      <td className="px-2 py-1.5">
        <SelectControl
          aria-label="Priority"
          value={draft.priority}
          onValueChange={(value) => set('priority', value as TaskPriority)}
          options={TASK_PRIORITIES.map((value) => ({ value, label: TASK_PRIORITY_LABELS[value] }))}
        />
      </td>
      <td className="px-2 py-1.5">
        <SelectControl
          aria-label="Assigned to"
          placeholder="Belum ada"
          value={draft.assigneeId}
          onValueChange={(value) => set('assigneeId', value)}
          options={members.map((member) => ({ value: member.userId, label: member.name }))}
        />
      </td>

      <DateInputs
        labels={['Dev Plan Start', 'Dev Plan End', 'Dev Actual Start', 'Dev Actual End']}
        values={[draft.devPlanStart, draft.devPlanEnd, draft.devActualStart, draft.devActualEnd]}
        onChange={[
          (value) => set('devPlanStart', value),
          (value) => set('devPlanEnd', value),
          (value) => set('devActualStart', value),
          (value) => set('devActualEnd', value),
        ]}
      />
      <td className="px-2 py-1.5">
        <PercentInput
          label="Dev % Done"
          value={draft.devCompletion}
          onChange={(value) => set('devCompletion', value)}
        />
      </td>
      <td className="w-44 px-2 py-1.5">
        <SelectControl
          aria-label="Status Dev"
          value={draft.devStatus}
          onValueChange={(value) => set('devStatus', value as DevStatus)}
          options={DEV_STATUSES.map((value) => ({ value, label: DEV_STATUS_LABELS[value] }))}
        />
      </td>

      <DateInputs
        labels={['Test Plan Start', 'Test Plan End', 'Test Actual Start', 'Test Actual End']}
        values={[draft.testPlanStart, draft.testPlanEnd, draft.testActualStart, draft.testActualEnd]}
        onChange={[
          (value) => set('testPlanStart', value),
          (value) => set('testPlanEnd', value),
          (value) => set('testActualStart', value),
          (value) => set('testActualEnd', value),
        ]}
      />
      <td className="px-2 py-1.5">
        <PercentInput
          label="Test % Done"
          value={draft.testCompletion}
          onChange={(value) => set('testCompletion', value)}
        />
      </td>
      <td className="w-44 px-2 py-1.5">
        <SelectControl
          aria-label="Status Test"
          value={draft.testStatus}
          onValueChange={(value) => set('testStatus', value as TestStatus)}
          options={TEST_STATUSES.map((value) => ({ value, label: TEST_STATUS_LABELS[value] }))}
        />
      </td>

      <td className="px-2 py-1.5">
        <input
          className={cn(CELL_INPUT, 'min-w-40')}
          aria-label="Remark Dev/Test"
          placeholder="Catatan"
          value={draft.remark}
          maxLength={1000}
          onChange={(event) => set('remark', event.target.value)}
        />
      </td>

      <td className="px-3 py-2">
        <div className="flex justify-end gap-1">
          <Button size="icon-sm" aria-label="Simpan baris" title="Simpan" loading={saving} onClick={onSave}>
            <Check className="h-3.5 w-3.5" aria-hidden />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Batal"
            title="Batal"
            disabled={saving}
            onClick={onCancel}
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </div>
      </td>
    </tr>
  );
}

/** The four date cells of one half, so the two halves cannot drift apart. */
function DateInputs({
  labels,
  values,
  onChange,
}: {
  labels: string[];
  values: string[];
  onChange: ((value: string) => void)[];
}) {
  return (
    <>
      {values.map((value, index) => (
        <td key={labels[index]} className="px-2 py-1.5">
          <input
            type="date"
            aria-label={labels[index]}
            className={cn(CELL_INPUT, 'w-32')}
            value={value}
            onChange={(event) => onChange[index]?.(event.target.value)}
          />
        </td>
      ))}
    </>
  );
}

function PercentInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        min={0}
        max={100}
        aria-label={label}
        className={cn(CELL_INPUT, 'w-16 text-right tabular-nums')}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <span className="text-xs text-slate-500">%</span>
    </div>
  );
}

/** An API message where there is one, a fallback where the failure is local. */
function messageOf(error: unknown, fallback: string): string | null {
  if (!error) return null;
  if (error instanceof ApiClientError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function DateCells({ values }: { values: (string | null)[] }) {
  return (
    <>
      {values.map((value, index) => (
        <td key={index} className="whitespace-nowrap px-3 py-2 text-xs">
          {shortDate(value)}
        </td>
      ))}
    </>
  );
}

function Pill({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        className,
      )}
    >
      {children}
    </span>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-center">
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className={cn('text-lg font-bold', tone ?? 'text-slate-900')}>{value}</p>
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span aria-hidden className={cn('size-2 rounded-full', className)} />
      {label}
    </span>
  );
}

function Filter({
  label,
  value,
  onChange,
  placeholder,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="w-48">
      <span className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span>
      <SelectControl
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onValueChange={onChange}
        options={options}
      />
    </div>
  );
}

export type { SaveProjectTaskInput };
