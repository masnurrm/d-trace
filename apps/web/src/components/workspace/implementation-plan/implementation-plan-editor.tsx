'use client';

import { useMutation } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  CheckCheck,
  Copy,
  Download,
  ListPlus,
  Play,
  Plus,
  RotateCcw,
  Save,
  ServerCog,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  IMPLEMENTATION_PLAN_STATUS_LABELS,
  IMPLEMENTATION_STEP_MAX_MINUTES,
  IMPLEMENTATION_STEP_STATUSES,
  IMPLEMENTATION_STEP_STATUS_LABELS,
  actualStepSeconds,
  clockOfMinutes,
  formatSpan,
  saveImplementationPlanSchema,
  scheduleImplementationPlan,
  summarizeImplementationPlan,
  type ImplementationHostView,
  type ImplementationPhaseView,
  type ImplementationPlanView,
  type ImplementationStepStatus,
  type ImplementationStepView,
} from '@dtrace/shared';
import { ApiClientError, clientFetch } from '@/lib/api/client';
import { formatDateTime } from '@/lib/utils/format';
import { useLocalTimeZone } from '@/lib/utils/use-local-time-zone';
import { cn } from '@/lib/utils/cn';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { SelectControl, TextField } from '@/components/ui/field';
import { toast } from '@/components/ui/sonner';

/** The grid's own input: sized for a dense table, not for a form. */
const CELL_INPUT =
  'w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 outline-none focus:border-sky-500 disabled:bg-slate-50 disabled:text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:disabled:bg-slate-950';

/** Grows with what is typed, so a long activity never hides behind a scrollbar. */
const CELL_TEXTAREA = cn(CELL_INPUT, 'min-h-8 resize-y [field-sizing:content]');

/** No, Activity, Host, Downtime, PIC, 3 × Estimate, 3 × Actual, Status, Note. */
const DATA_COLUMNS = 13;

const STATUS_DOT: Record<ImplementationStepStatus, string> = {
  NOT_STARTED: 'bg-slate-400',
  IN_PROGRESS: 'bg-amber-500',
  DONE: 'bg-emerald-500',
  FAILED: 'bg-red-500',
  SKIPPED: 'bg-slate-300 dark:bg-slate-600',
};

const STATUS_OPTIONS = IMPLEMENTATION_STEP_STATUSES.map((value) => ({
  value,
  label: IMPLEMENTATION_STEP_STATUS_LABELS[value],
  dot: STATUS_DOT[value],
}));

/** A small button in a table cell — the stopwatch's Start and Finish. */
const STAMP_BUTTON =
  'inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-sky-600 px-2 py-1 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-50 dark:bg-sky-500 dark:hover:bg-sky-600';

const newId = () => crypto.randomUUID();

function blankStep(carry?: Pick<ImplementationStepView, 'host' | 'pic'>): ImplementationStepView {
  return {
    id: newId(),
    activity: '',
    host: carry?.host ?? '',
    downtime: false,
    pic: carry?.pic ?? '',
    durationMinutes: 5,
    estimatedStartTime: null,
    estimatedEndTime: null,
    actualStartedAt: null,
    actualFinishedAt: null,
    actualDurationMinutes: null,
    status: 'NOT_STARTED',
    note: '',
  };
}

/* -------------------------------------------------------------------------- */
/* Clock helpers                                                               */
/* -------------------------------------------------------------------------- */

const pad = (value: number) => String(value).padStart(2, '0');

/** `22:05:09` for an instant, in the given zone — UTC until hydration names the reader's. */
function clockFormatter(timeZone: string | undefined) {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZone: timeZone ?? 'UTC',
  });
}

/** An instant as the browser's own wall clock, for a time input to edit. */
function localClock(iso: string): string {
  const date = new Date(iso);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function parseClock(value: string): [number, number, number] | null {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}

/** The same local day as `iso`, at another time of it. */
function atClock(iso: string, value: string): string | null {
  const clock = parseClock(value);
  if (!clock) return null;
  const date = new Date(iso);
  date.setHours(clock[0], clock[1], clock[2], 0);
  return date.toISOString();
}

/**
 * The first moment at `value` o'clock that is not before `startIso`.
 *
 * A finish typed as a time of day is read as the next such time after the
 * start: a step started at 23:50 and finished at 00:10 finished the next day,
 * not twenty-three hours before it began. A single step is never longer than
 * a day, so the next occurrence is always the right one.
 */
function clockAfter(startIso: string, value: string): string | null {
  const candidate = atClock(startIso, value);
  if (!candidate) return null;
  const date = new Date(candidate);
  if (date.getTime() < Date.parse(startIso)) date.setDate(date.getDate() + 1);
  return date.toISOString();
}

/** Ticks every second while `active`, so a running step's elapsed time moves. */
function useNow(active: boolean): number | null {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (!active) return;
    const tick = () => setNow(Date.now());
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [active]);

  return active ? now : null;
}

/** A clock reading after the start of the day, with `+1` when it falls on the next. */
function EstimateClock({ minutes }: { minutes: number }) {
  const { time, dayOffset } = clockOfMinutes(minutes);
  return (
    <span className="whitespace-nowrap tabular-nums">
      {time}
      {dayOffset > 0 && (
        <sup
          className="ml-0.5 text-[10px] font-semibold text-amber-600"
          title={`${dayOffset} hari setelah tanggal implementasi`}
        >
          +{dayOffset}
        </sup>
      )}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* The editor                                                                  */
/* -------------------------------------------------------------------------- */

export interface ImplementationPlanEditorProps {
  projectId: string;
  projectName: string;
  plan: ImplementationPlanView;
  canEdit: boolean;
}

/**
 * The implementation plan: phases of steps, each with an estimated duration
 * that lays out the schedule and an actual start and finish recorded while the
 * cut-over runs.
 *
 * Edited **in place, whole**, and saved as one document, like the test
 * scripts — and for the same reason the save carries the version it loaded.
 *
 * The estimated start and end are never typed. Each step starts where the one
 * above it ended, counted from the start time in the header, so reordering a
 * step or changing one duration reschedules everything below it — which is
 * what a runbook's schedule actually does on the night.
 */
export function ImplementationPlanEditor({
  projectId,
  projectName,
  plan,
  canEdit,
}: ImplementationPlanEditorProps) {
  const timeZone = useLocalTimeZone();
  const clock = useMemo(() => clockFormatter(timeZone), [timeZone]);

  const [serviceName, setServiceName] = useState(plan.serviceName);
  const [implementationDate, setImplementationDate] = useState(plan.implementationDate ?? '');
  const [startTime, setStartTime] = useState(plan.startTime);
  const [hosts, setHosts] = useState<ImplementationHostView[]>(plan.hosts);
  const [phases, setPhases] = useState<ImplementationPhaseView[]>(plan.phases);

  /** What the server last confirmed — the guard sent with the next save. */
  const [saved, setSaved] = useState(plan);
  const [dirty, setDirty] = useState(false);
  const [exporting, setExporting] = useState(false);

  // A night's worth of recorded timings must not vanish to a stray tab close.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const summary = useMemo(() => summarizeImplementationPlan(phases), [phases]);
  const schedule = useMemo(
    () => scheduleImplementationPlan(startTime, phases),
    [startTime, phases],
  );
  const running = phases.some((phase) =>
    phase.steps.some((step) => step.actualStartedAt && !step.actualFinishedAt),
  );
  const now = useNow(running);

  const readOnly = !canEdit;
  const hostListId = `implementation-hosts-${projectId}`;
  const finishedAt = clockOfMinutes(schedule.end);

  function touch(next: ImplementationPhaseView[]) {
    setPhases(next);
    setDirty(true);
  }

  /* ------------------------------- hosts -------------------------------- */

  function updateHost(index: number, patch: Partial<ImplementationHostView>) {
    setHosts(hosts.map((host, i) => (i === index ? { ...host, ...patch } : host)));
    setDirty(true);
  }

  function addHost() {
    setHosts([...hosts, { id: newId(), label: `Host ${hosts.length + 1}`, address: '' }]);
    setDirty(true);
  }

  function removeHost(index: number) {
    setHosts(hosts.filter((_, i) => i !== index));
    setDirty(true);
  }

  /* ----------------------------- structure ------------------------------ */

  function updatePhase(pi: number, patch: Partial<ImplementationPhaseView>) {
    touch(phases.map((phase, i) => (i === pi ? { ...phase, ...patch } : phase)));
  }

  function updateStep(pi: number, si: number, patch: Partial<ImplementationStepView>) {
    const phase = phases[pi]!;
    updatePhase(pi, {
      steps: phase.steps.map((step, i) => (i === si ? { ...step, ...patch } : step)),
    });
  }

  function addPhase() {
    touch([...phases, { id: newId(), name: `Fase ${phases.length + 1}`, steps: [blankStep()] }]);
  }

  function removePhase(pi: number) {
    const phase = phases[pi]!;
    if (
      phase.steps.length > 0 &&
      !window.confirm(
        `Hapus "${phase.name || 'fase ini'}" beserta ${phase.steps.length} aktivitasnya?`,
      )
    ) {
      return;
    }
    touch(phases.filter((_, i) => i !== pi));
  }

  function addStep(pi: number) {
    // Host and PIC carry over: consecutive steps nearly always run on the
    // same server by the same person.
    const last = phases[pi]!.steps.at(-1);
    updatePhase(pi, { steps: [...phases[pi]!.steps, blankStep(last)] });
  }

  /** Copies a step in directly below itself, with its timings and status reset. */
  function duplicateStep(pi: number, si: number) {
    const steps = [...phases[pi]!.steps];
    const source = steps[si]!;
    steps.splice(si + 1, 0, {
      ...source,
      id: newId(),
      actualStartedAt: null,
      actualFinishedAt: null,
      actualDurationMinutes: null,
      status: 'NOT_STARTED',
    });
    updatePhase(pi, { steps });
  }

  function removeStep(pi: number, si: number) {
    updatePhase(pi, { steps: phases[pi]!.steps.filter((_, i) => i !== si) });
  }

  /**
   * Moves a step one place, across a phase boundary when it is at the edge.
   * The whole plan is one sequence — the schedule runs straight through the
   * phases — so the first step of a phase moving up becomes the last of the
   * phase above, rather than stopping at a wall the schedule does not have.
   */
  function moveStep(pi: number, si: number, direction: -1 | 1) {
    const next = phases.map((phase) => ({ ...phase, steps: [...phase.steps] }));
    const [step] = next[pi]!.steps.splice(si, 1);
    if (!step) return;

    if (direction === -1) {
      if (si > 0) next[pi]!.steps.splice(si - 1, 0, step);
      else next[pi - 1]!.steps.push(step);
    } else if (si < phases[pi]!.steps.length - 1) {
      next[pi]!.steps.splice(si + 1, 0, step);
    } else {
      next[pi + 1]!.steps.unshift(step);
    }
    touch(next);
  }

  function resetActual() {
    const recorded = phases.some((phase) =>
      phase.steps.some((step) => step.actualStartedAt || step.status !== 'NOT_STARTED'),
    );
    if (!recorded) return;
    if (!window.confirm('Kosongkan semua waktu aktual dan kembalikan status ke Not Started?'))
      return;
    touch(
      phases.map((phase) => ({
        ...phase,
        steps: phase.steps.map((step) => ({
          ...step,
          actualStartedAt: null,
          actualFinishedAt: null,
          status: 'NOT_STARTED' as const,
        })),
      })),
    );
  }

  /* -------------------------------- save -------------------------------- */

  const save = useMutation({
    mutationFn: async (complete: boolean) => {
      const parsed = saveImplementationPlanSchema.safeParse({
        serviceName,
        implementationDate: implementationDate || null,
        startTime,
        hosts,
        phases,
        complete,
        expectedUpdatedAt: saved.updatedAt,
      });
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new Error(issue ? describeIssue(issue, phases) : 'Implementation plan belum valid');
      }

      const result = await clientFetch<ImplementationPlanView>(
        `/workspace/projects/${projectId}/implementation-plan`,
        { method: 'PUT', body: parsed.data },
      );
      return result.data;
    },
    onSuccess: (next, complete) => {
      setSaved(next);
      setDirty(false);
      toast.success(complete ? 'Implementasi ditandai selesai.' : 'Draft tersimpan.');
    },
  });

  function complete() {
    const open = summary.total - summary.settled;
    if (open > 0) {
      toast.error(`Masih ada ${open} aktivitas yang belum Done atau Skipped.`);
      return;
    }
    save.mutate(true);
  }

  async function exportExcel() {
    setExporting(true);
    try {
      const { exportImplementationPlan } = await import('./implementation-plan-export');
      await exportImplementationPlan({
        projectName,
        serviceName,
        implementationDate: implementationDate || null,
        startTime,
        hosts,
        phases,
        status: saved.status,
        completedAt: saved.completedAt,
        completedByName: saved.completedByName,
        timeZone,
      });
    } catch {
      toast.error('Export gagal. Coba lagi.');
    } finally {
      setExporting(false);
    }
  }

  const error = save.error
    ? save.error instanceof ApiClientError
      ? (save.error.details?.[0]?.message ?? save.error.message)
      : save.error.message
    : null;

  let number = 0;

  return (
    <div className="space-y-4">
      {error && <Alert tone="danger">{error}</Alert>}

      <Card>
        <CardHeader
          title="Implementation Plan"
          description={`${projectName} — urutan aktivitas, estimasi, dan aktualnya.`}
          icon={<ServerCog className="h-4 w-4" aria-hidden />}
          tinted
          action={
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={saved.status === 'COMPLETED' ? 'success' : 'neutral'}>
                {IMPLEMENTATION_PLAN_STATUS_LABELS[saved.status]}
              </Badge>
              {saved.status === 'COMPLETED' && saved.completedAt && (
                <span className="text-xs text-slate-500">
                  oleh {saved.completedByName ?? '—'} ·{' '}
                  {formatDateTime(saved.completedAt, timeZone)}
                </span>
              )}
              {dirty && <Badge tone="warning">Belum disimpan</Badge>}
              <Button
                variant="outline"
                leftIcon={<Download className="h-4 w-4" aria-hidden />}
                loading={exporting}
                disabled={exporting}
                onClick={() => void exportExcel()}
              >
                Export Excel
              </Button>
            </div>
          }
        />

        <div className="grid gap-4 px-5 pt-4 sm:grid-cols-3">
          <TextField
            label="Service Name"
            name="serviceName"
            value={serviceName}
            disabled={readOnly}
            onChange={(event) => {
              setServiceName(event.target.value);
              setDirty(true);
            }}
          />
          <TextField
            label="Tanggal Implementasi"
            name="implementationDate"
            type="date"
            value={implementationDate}
            disabled={readOnly}
            onChange={(event) => {
              setImplementationDate(event.target.value);
              setDirty(true);
            }}
          />
          <TextField
            label="Jam Mulai (Estimasi)"
            name="startTime"
            type="time"
            value={startTime}
            disabled={readOnly}
            onChange={(event) => {
              // A cleared time input reports ''; the schedule needs a start.
              if (!event.target.value) return;
              setStartTime(event.target.value.slice(0, 5));
              setDirty(true);
            }}
          />
        </div>

        <div className="px-5 pb-4 pt-4">
          <p className="mb-2 text-xs font-medium text-slate-700 dark:text-slate-300">
            Server / Host
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {hosts.map((host, index) => (
              <div
                key={host.id}
                className="space-y-1.5 rounded-lg border border-slate-200 p-2.5 dark:border-slate-800"
              >
                <div className="flex items-center gap-1">
                  <input
                    aria-label="Nama host"
                    className={cn(
                      CELL_INPUT,
                      'border-transparent bg-transparent px-1 font-semibold dark:border-transparent dark:bg-transparent',
                    )}
                    value={host.label}
                    placeholder="Nama host"
                    disabled={readOnly}
                    onChange={(event) => updateHost(index, { label: event.target.value })}
                  />
                  {canEdit && (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Hapus ${host.label || 'host'}`}
                      title="Hapus host"
                      onClick={() => removeHost(index)}
                    >
                      <X className="h-3 w-3" aria-hidden />
                    </Button>
                  )}
                </div>
                <input
                  aria-label={`Alamat ${host.label || 'host'}`}
                  className={CELL_INPUT}
                  value={host.address}
                  placeholder="10.10.1.11 / hostname"
                  disabled={readOnly}
                  onChange={(event) => updateHost(index, { address: event.target.value })}
                />
              </div>
            ))}
            {canEdit && hosts.length < 20 && (
              <button
                type="button"
                onClick={addHost}
                className="flex min-h-20 items-center justify-center gap-1 rounded-lg border border-dashed border-slate-300 text-xs text-sky-700 hover:bg-slate-50 dark:border-slate-700 dark:text-sky-400 dark:hover:bg-slate-900"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                Tambah Host
              </button>
            )}
            {readOnly && hosts.length === 0 && (
              <p className="text-xs text-slate-500">Belum ada host.</p>
            )}
          </div>
          {/* Suggestions for the Hostname / IP column, from the hosts named above. */}
          <datalist id={hostListId}>
            {hosts
              .filter((host) => host.address)
              .map((host) => (
                <option key={host.id} value={host.address}>
                  {host.label}
                </option>
              ))}
          </datalist>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Progres" value={`${summary.settled}/${summary.total}`} />
        <Stat
          label="Estimasi selesai"
          value={
            <>
              {finishedAt.time}
              {finishedAt.dayOffset > 0 && (
                <span className="ml-1 text-xs font-medium text-amber-600">
                  +{finishedAt.dayOffset} hari
                </span>
              )}
            </>
          }
        />
        <Stat
          label="Total downtime (est.)"
          value={formatSpan(summary.estimatedDowntimeMinutes * 60)}
          tone="text-red-700 dark:text-red-400"
        />
        <Stat label="Total durasi (aktual)" value={formatSpan(summary.actualSeconds)} />
        <Stat
          label="Failed"
          value={summary.failed}
          tone={summary.failed > 0 ? 'text-red-700 dark:text-red-400' : undefined}
        />
      </div>

      <div
        className="flex h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"
        aria-hidden
      >
        {summary.total > 0 && (
          <>
            <i
              className="block h-full bg-emerald-500"
              style={{ width: `${(summary.settled / summary.total) * 100}%` }}
            />
            <i
              className="block h-full bg-red-500"
              style={{ width: `${(summary.failed / summary.total) * 100}%` }}
            />
          </>
        )}
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-410 border-collapse text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500 dark:bg-slate-900/60">
              <tr>
                <th rowSpan={2} className="w-10 px-2 py-2">
                  No
                </th>
                <th rowSpan={2} className="px-2 py-2">
                  Activity
                </th>
                <th rowSpan={2} className="w-40 px-2 py-2">
                  Hostname / IP
                </th>
                <th rowSpan={2} className="w-20 px-2 py-2">
                  Downtime
                </th>
                <th rowSpan={2} className="w-24 px-2 py-2">
                  PIC
                </th>
                <th
                  colSpan={3}
                  className="border-l border-slate-200 px-2 py-1.5 text-center dark:border-slate-800"
                >
                  Estimate
                </th>
                <th
                  colSpan={3}
                  className="border-l border-slate-200 px-2 py-1.5 text-center dark:border-slate-800"
                >
                  Actual
                </th>
                <th
                  rowSpan={2}
                  className="w-40 border-l border-slate-200 px-2 py-2 dark:border-slate-800"
                >
                  Status
                </th>
                <th rowSpan={2} className="w-44 px-2 py-2">
                  Note
                </th>
                {canEdit && <th rowSpan={2} className="w-28 px-2 py-2" />}
              </tr>
              <tr>
                <th className="w-16 border-l border-slate-200 px-2 py-1.5 dark:border-slate-800">
                  Start
                </th>
                <th className="w-20 px-2 py-1.5">Durasi (mnt)</th>
                <th className="w-16 px-2 py-1.5">End</th>
                <th className="w-32 border-l border-slate-200 px-2 py-1.5 dark:border-slate-800">
                  Start
                </th>
                <th className="w-20 px-2 py-1.5">Duration</th>
                <th className="w-32 px-2 py-1.5">End</th>
              </tr>
            </thead>

            {phases.map((phase, pi) => {
              const phaseMinutes = phase.steps.reduce((sum, step) => sum + step.durationMinutes, 0);
              return (
                <tbody key={phase.id}>
                  <tr className="border-t border-slate-200 bg-sky-50 dark:border-slate-800 dark:bg-sky-950/40">
                    <td colSpan={DATA_COLUMNS + (canEdit ? 1 : 0)} className="px-3 py-2">
                      {/* Pinned to the left edge of the scroll area: the band is as wide
                          as the whole table, and its controls must stay in view while
                          the columns scroll. */}
                      <div className="sticky left-3 flex w-fit max-w-[calc(100vw-5rem)] flex-wrap items-center gap-2">
                        <input
                          aria-label="Nama fase"
                          className={cn(
                            CELL_INPUT,
                            'w-56 text-sm font-semibold text-sky-800 sm:w-72 dark:text-sky-300',
                          )}
                          value={phase.name}
                          placeholder="Nama fase"
                          disabled={readOnly}
                          onChange={(event) => updatePhase(pi, { name: event.target.value })}
                        />
                        <span className="whitespace-nowrap text-xs text-slate-500">
                          {phase.steps.length} aktivitas · {phaseMinutes} mnt
                        </span>
                        {canEdit && (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              leftIcon={<Plus className="h-3.5 w-3.5" aria-hidden />}
                              onClick={() => addStep(pi)}
                            >
                              Tambah Aktivitas
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Hapus ${phase.name || 'fase'}`}
                              title="Hapus fase"
                              onClick={() => removePhase(pi)}
                            >
                              <Trash2 className="h-3.5 w-3.5 text-red-500" aria-hidden />
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>

                  {phase.steps.map((step, si) => {
                    number += 1;
                    const estimate = schedule.steps[step.id] ?? { start: 0, end: 0 };
                    return (
                      <StepRow
                        key={step.id}
                        number={number}
                        step={step}
                        estimate={estimate}
                        readOnly={readOnly}
                        clock={clock}
                        now={now}
                        hostListId={hostListId}
                        canMoveUp={si > 0 || pi > 0}
                        canMoveDown={si < phase.steps.length - 1 || pi < phases.length - 1}
                        onChange={(patch) => updateStep(pi, si, patch)}
                        onMove={(direction) => moveStep(pi, si, direction)}
                        onDuplicate={() => duplicateStep(pi, si)}
                        onRemove={() => removeStep(pi, si)}
                      />
                    );
                  })}

                  {phase.steps.length === 0 && (
                    <tr>
                      <td
                        colSpan={DATA_COLUMNS + (canEdit ? 1 : 0)}
                        className="px-4 py-4 text-center text-xs text-slate-500"
                      >
                        Belum ada aktivitas di fase ini.
                      </td>
                    </tr>
                  )}
                </tbody>
              );
            })}

            {phases.length === 0 && (
              <tbody>
                <tr>
                  <td
                    colSpan={DATA_COLUMNS + (canEdit ? 1 : 0)}
                    className="px-4 py-10 text-center text-sm text-slate-500"
                  >
                    Belum ada fase. {canEdit && 'Mulai dengan “Tambah Fase”.'}
                  </td>
                </tr>
              </tbody>
            )}

            <tfoot className="bg-slate-50 text-xs font-semibold text-slate-700 dark:bg-slate-900/60 dark:text-slate-300">
              <TotalRow
                label="Total Duration"
                estimated={summary.estimatedMinutes * 60}
                actual={summary.actualSeconds}
                trailing={canEdit ? 4 : 3}
              />
              <TotalRow
                label="Total Downtime Duration"
                estimated={summary.estimatedDowntimeMinutes * 60}
                actual={summary.actualDowntimeSeconds}
                trailing={canEdit ? 4 : 3}
                tone="text-red-700 dark:text-red-400"
              />
            </tfoot>
          </table>
        </div>

        {canEdit && (
          <div className="border-t border-slate-200 bg-slate-50 px-4 py-2 dark:border-slate-800 dark:bg-slate-900/60">
            <Button
              variant="outline"
              size="sm"
              leftIcon={<ListPlus className="h-3.5 w-3.5" aria-hidden />}
              onClick={addPhase}
            >
              Tambah Fase
            </Button>
          </div>
        )}
      </Card>

      {canEdit && (
        // Sticky, because the plan is long and the save is the one thing
        // nobody running a cut-over should have to scroll back up to find.
        <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-slate-50/95 px-1 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
          {saved.updatedAt && (
            <span className="mr-auto text-xs text-slate-500">
              Terakhir disimpan {formatDateTime(saved.updatedAt, timeZone)}
            </span>
          )}
          <Button
            variant="outline"
            leftIcon={<RotateCcw className="h-4 w-4" aria-hidden />}
            disabled={save.isPending}
            onClick={resetActual}
          >
            Reset Actual
          </Button>
          <Button
            variant="outline"
            leftIcon={<Save className="h-4 w-4" aria-hidden />}
            loading={save.isPending && save.variables === false}
            disabled={save.isPending}
            onClick={() => save.mutate(false)}
          >
            Simpan Draft
          </Button>
          <Button
            leftIcon={<CheckCheck className="h-4 w-4" aria-hidden />}
            loading={save.isPending && save.variables === true}
            disabled={save.isPending || summary.total === 0}
            onClick={complete}
          >
            Tandai Implementasi Selesai
          </Button>
        </div>
      )}
    </div>
  );
}

/** A validation issue, naming the row it is about when it is about a row. */
function describeIssue(
  issue: { path: PropertyKey[]; message: string },
  phases: ImplementationPhaseView[],
): string {
  const [head, pi, sub, si] = issue.path;
  if (head === 'phases' && typeof pi === 'number' && sub === 'steps' && typeof si === 'number') {
    const number = phases.slice(0, pi).reduce((sum, phase) => sum + phase.steps.length, 0) + si + 1;
    return `Aktivitas no. ${number}: ${issue.message}`;
  }
  return issue.message;
}

function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 dark:border-slate-800 dark:bg-slate-900">
      <p
        className={cn(
          'text-xl font-semibold tabular-nums text-slate-900 dark:text-slate-100',
          tone,
        )}
      >
        {value}
      </p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}

function TotalRow({
  label,
  estimated,
  actual,
  trailing,
  tone,
}: {
  label: string;
  estimated: number;
  actual: number;
  /** Cells after the actual duration: actual end, status, note, and actions when shown. */
  trailing: number;
  tone?: string;
}) {
  return (
    <tr className="border-t border-slate-200 dark:border-slate-800">
      <td colSpan={5} className="px-3 py-2">
        {label}
      </td>
      <td className="border-l border-slate-200 dark:border-slate-800" />
      <td className={cn('px-2 py-2 tabular-nums', tone)}>{formatSpan(estimated)}</td>
      <td />
      <td className="border-l border-slate-200 dark:border-slate-800" />
      <td className={cn('px-2 py-2 tabular-nums', tone)}>{formatSpan(actual)}</td>
      <td colSpan={trailing} />
    </tr>
  );
}

/* -------------------------------------------------------------------------- */
/* One step                                                                    */
/* -------------------------------------------------------------------------- */

interface StepRowProps {
  number: number;
  step: ImplementationStepView;
  estimate: { start: number; end: number };
  readOnly: boolean;
  clock: Intl.DateTimeFormat;
  now: number | null;
  hostListId: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onChange: (patch: Partial<ImplementationStepView>) => void;
  onMove: (direction: -1 | 1) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}

function StepRow({
  number,
  step,
  estimate,
  readOnly,
  clock,
  now,
  hostListId,
  canMoveUp,
  canMoveDown,
  onChange,
  onMove,
  onDuplicate,
  onRemove,
}: StepRowProps) {
  const actual = actualStepSeconds(step);
  const elapsed =
    step.actualStartedAt && !step.actualFinishedAt && now !== null
      ? Math.max(0, (now - Date.parse(step.actualStartedAt)) / 1000)
      : null;
  const overran = actual !== null && actual > step.durationMinutes * 60;

  function editStart(value: string) {
    if (!step.actualStartedAt) return;
    const startedAt = atClock(step.actualStartedAt, value);
    if (!startedAt) return;
    // The finish keeps its time of day and is re-anchored after the new
    // start, so moving a start never leaves the finish before it.
    const finishedAt = step.actualFinishedAt
      ? clockAfter(startedAt, localClock(step.actualFinishedAt))
      : null;
    onChange({
      actualStartedAt: startedAt,
      actualFinishedAt: finishedAt,
      actualDurationMinutes: null,
    });
  }

  function editFinish(value: string) {
    if (!step.actualStartedAt) return;
    const finishedAt = clockAfter(step.actualStartedAt, value);
    if (finishedAt) onChange({ actualFinishedAt: finishedAt, actualDurationMinutes: null });
  }

  return (
    <tr
      className={cn(
        'border-t border-slate-100 align-top dark:border-slate-800',
        step.status === 'FAILED' && 'bg-red-50/60 dark:bg-red-950/20',
      )}
    >
      <td
        className={cn(
          'px-2 py-2 pt-3 text-xs text-slate-500',
          // A red edge on every step that takes the service down, so the
          // downtime window is visible as a stripe down the plan.
          step.downtime && 'shadow-[inset_3px_0_0_var(--color-red-500)]',
        )}
      >
        {number}
      </td>
      <td className="min-w-64 px-2 py-2">
        <textarea
          aria-label="Activity"
          className={CELL_TEXTAREA}
          rows={1}
          value={step.activity}
          placeholder="Aktivitas"
          disabled={readOnly}
          onChange={(event) => onChange({ activity: event.target.value })}
        />
      </td>
      <td className="px-2 py-2">
        <input
          aria-label="Hostname / IP"
          className={cn(CELL_INPUT, 'min-w-36')}
          list={hostListId}
          value={step.host}
          disabled={readOnly}
          onChange={(event) => onChange({ host: event.target.value })}
        />
      </td>
      <td className="px-2 py-2">
        <select
          aria-label="Downtime"
          disabled={readOnly}
          value={step.downtime ? 'yes' : 'no'}
          onChange={(event) => onChange({ downtime: event.target.value === 'yes' })}
          className={cn(CELL_INPUT, 'min-w-16 font-semibold', step.downtime && 'text-red-700')}
        >
          <option value="no">No</option>
          <option value="yes">Yes</option>
        </select>
      </td>
      <td className="px-2 py-2">
        <input
          aria-label="PIC"
          className={cn(CELL_INPUT, 'min-w-24')}
          value={step.pic}
          disabled={readOnly}
          onChange={(event) => onChange({ pic: event.target.value })}
        />
      </td>

      <td className="border-l border-slate-100 px-2 py-2 dark:border-slate-800">
        <input
          aria-label="Estimate start"
          type="time"
          className={cn(CELL_INPUT, 'w-24 tabular-nums')}
          value={step.estimatedStartTime ?? clockOfMinutes(estimate.start).time}
          disabled={readOnly}
          onChange={(event) => {
            const value = event.target.value;
            const patch: Partial<ImplementationStepView> = { estimatedStartTime: value || null };
            if (value && step.estimatedEndTime) {
              let start = Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
              let end =
                Number(step.estimatedEndTime.slice(0, 2)) * 60 +
                Number(step.estimatedEndTime.slice(3, 5));
              while (end <= start) end += 24 * 60;
              patch.durationMinutes = end - start;
            }
            onChange(patch);
          }}
        />
      </td>
      <td className="px-2 py-2">
        <DurationInput
          value={step.durationMinutes}
          disabled={readOnly}
          onChange={(durationMinutes) => onChange({ durationMinutes, estimatedEndTime: null })}
        />
      </td>
      <td className="px-2 py-2">
        <input
          aria-label="Estimate end"
          type="time"
          className={cn(CELL_INPUT, 'w-24 tabular-nums')}
          value={step.estimatedEndTime ?? clockOfMinutes(estimate.end).time}
          disabled={readOnly}
          onChange={(event) => {
            const value = event.target.value;
            if (!value) {
              onChange({ estimatedEndTime: null });
              return;
            }
            const startTime = step.estimatedStartTime ?? clockOfMinutes(estimate.start).time;
            const start = Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3, 5));
            let end = Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
            while (end <= start) end += 24 * 60;
            onChange({ estimatedEndTime: value, durationMinutes: end - start });
          }}
        />
      </td>

      <td className="border-l border-slate-100 px-2 py-2 dark:border-slate-800">
        <ActualCell
          label="Start"
          value={step.actualStartedAt}
          clock={clock}
          readOnly={readOnly}
          icon={<Play className="h-3 w-3" aria-hidden />}
          onStamp={() =>
            onChange({
              actualStartedAt: new Date().toISOString(),
              actualFinishedAt: null,
              actualDurationMinutes: null,
              status: 'IN_PROGRESS',
            })
          }
          onEdit={editStart}
          onClear={() =>
            onChange({
              actualStartedAt: null,
              actualFinishedAt: null,
              actualDurationMinutes: null,
              status:
                step.status === 'IN_PROGRESS' || step.status === 'DONE'
                  ? 'NOT_STARTED'
                  : step.status,
            })
          }
        />
      </td>
      <td className="px-2 py-2 text-xs tabular-nums">
        {!readOnly ? (
          <input
            aria-label="Actual duration (menit)"
            type="number"
            min={0}
            max={IMPLEMENTATION_STEP_MAX_MINUTES}
            className={cn(CELL_INPUT, 'w-20 tabular-nums', overran && 'text-red-700')}
            value={step.actualDurationMinutes ?? (actual !== null ? Math.round(actual / 60) : '')}
            placeholder="Menit"
            onChange={(event) => {
              const value = event.target.value;
              onChange({
                actualDurationMinutes:
                  value === ''
                    ? null
                    : Math.min(
                        IMPLEMENTATION_STEP_MAX_MINUTES,
                        Math.max(0, Math.round(Number(value))),
                      ),
              });
            }}
          />
        ) : actual !== null ? (
          <span className={cn(overran ? 'font-semibold text-red-700' : 'text-slate-700')}>
            {formatSpan(actual)}
          </span>
        ) : elapsed !== null ? (
          <span className="italic text-amber-600" title="Sedang berjalan">
            {formatSpan(elapsed)}
          </span>
        ) : (
          <span className="text-slate-400">–</span>
        )}
      </td>
      <td className="px-2 py-2">
        {step.actualStartedAt ? (
          <ActualCell
            label="Finish"
            value={step.actualFinishedAt}
            clock={clock}
            readOnly={readOnly}
            icon={<Square className="h-3 w-3" aria-hidden />}
            onStamp={() =>
              onChange({
                actualFinishedAt: new Date().toISOString(),
                actualDurationMinutes: null,
                status: 'DONE',
              })
            }
            onEdit={editFinish}
            onClear={() =>
              onChange({
                actualFinishedAt: null,
                status: step.status === 'DONE' ? 'IN_PROGRESS' : step.status,
              })
            }
          />
        ) : (
          <span className="block pt-1 text-xs text-slate-400">–</span>
        )}
      </td>

      <td className="border-l border-slate-100 px-2 py-2 dark:border-slate-800">
        <SelectControl
          aria-label="Status"
          value={step.status}
          disabled={readOnly}
          options={STATUS_OPTIONS}
          clearable={false}
          onValueChange={(value) => {
            // A step always has a status; an emptied search box is not an answer.
            if (value) onChange({ status: value as ImplementationStepStatus });
          }}
          className="h-7 min-w-36 text-xs"
        />
      </td>
      <td className="px-2 py-2">
        <textarea
          aria-label="Note"
          className={cn(CELL_TEXTAREA, 'min-w-44')}
          rows={1}
          value={step.note}
          placeholder="Catatan"
          disabled={readOnly}
          onChange={(event) => onChange({ note: event.target.value })}
        />
      </td>

      {!readOnly && (
        <td className="px-2 py-2">
          <div className="flex justify-end gap-0.5">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Naikkan aktivitas ${number}`}
              title="Naikkan"
              disabled={!canMoveUp}
              onClick={() => onMove(-1)}
            >
              <ArrowUp className="h-3.5 w-3.5" aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Turunkan aktivitas ${number}`}
              title="Turunkan"
              disabled={!canMoveDown}
              onClick={() => onMove(1)}
            >
              <ArrowDown className="h-3.5 w-3.5" aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Duplikat aktivitas ${number}`}
              title="Duplikat ke baris di bawahnya"
              onClick={onDuplicate}
            >
              <Copy className="h-3.5 w-3.5" aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Hapus aktivitas ${number}`}
              title="Hapus aktivitas"
              onClick={onRemove}
            >
              <Trash2 className="h-3.5 w-3.5 text-red-500" aria-hidden />
            </Button>
          </div>
        </td>
      )}
    </tr>
  );
}

/**
 * Minutes, typed freely and committed only when they make a number.
 *
 * A controlled number input bound straight to the value would snap an emptied
 * field back to 1 on the first backspace; holding the draft while the field
 * has focus lets "15" be typed over "5" the way anyone expects.
 */
function DurationInput({
  value,
  disabled,
  onChange,
}: {
  value: number;
  disabled: boolean;
  onChange: (minutes: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <input
      aria-label="Durasi (menit)"
      type="number"
      min={1}
      max={IMPLEMENTATION_STEP_MAX_MINUTES}
      inputMode="numeric"
      className={cn(CELL_INPUT, 'w-16 tabular-nums')}
      value={draft ?? String(value)}
      disabled={disabled}
      onFocus={() => setDraft(String(value))}
      onBlur={() => setDraft(null)}
      onChange={(event) => {
        setDraft(event.target.value);
        const minutes = Math.round(Number(event.target.value));
        if (event.target.value !== '' && Number.isFinite(minutes) && minutes >= 1) {
          onChange(Math.min(minutes, IMPLEMENTATION_STEP_MAX_MINUTES));
        }
      }}
    />
  );
}

/**
 * An actual start or finish: a button until it is recorded, then the time it
 * was recorded at — editable, because the person who forgot to press Start
 * until two minutes in is the normal case, not the exception.
 */
function ActualCell({
  label,
  value,
  clock,
  readOnly,
  icon,
  onStamp,
  onEdit,
  onClear,
}: {
  label: string;
  value: string | null;
  clock: Intl.DateTimeFormat;
  readOnly: boolean;
  icon: ReactNode;
  onStamp: () => void;
  onEdit: (value: string) => void;
  onClear: () => void;
}) {
  if (!value) {
    return readOnly ? (
      <span className="block pt-1 text-xs text-slate-400">–</span>
    ) : (
      <button type="button" className={STAMP_BUTTON} onClick={onStamp}>
        {icon}
        {label}
      </button>
    );
  }

  const shown = clock.format(new Date(value));

  if (readOnly) {
    return (
      <span className="block pt-1 text-xs tabular-nums text-slate-700 dark:text-slate-300">
        {shown}
      </span>
    );
  }

  return (
    <div className="flex items-center gap-0.5">
      <input
        aria-label={`${label} aktual`}
        type="time"
        step={1}
        className={cn(CELL_INPUT, 'w-32 tabular-nums')}
        value={shown}
        onChange={(event) => onEdit(event.target.value)}
      />
      <button
        type="button"
        aria-label={`Kosongkan ${label.toLowerCase()} aktual`}
        title={`Kosongkan ${label.toLowerCase()} aktual`}
        className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
        onClick={onClear}
      >
        <X className="h-3 w-3" aria-hidden />
      </button>
    </div>
  );
}
