'use client';

import { useMutation } from '@tanstack/react-query';
import {
  CalendarRange,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Download,
  Layers,
  Save,
  TrendingUp,
  Wand2,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PROJECT_STAGES,
  PROJECT_STAGE_LABELS,
  calendarDays,
  isFinishedLate,
  scheduleSequentially,
  stageProgress,
  workingDaysBetween,
  type ProjectStage,
  type ProjectTimelineView,
  type TimelineTaskView,
} from '@dtrace/shared';
import { ApiClientError, clientFetch } from '@/lib/api/client';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils/cn';
import { STAGE_FILL, STAGE_ROW } from '../stage-palette';

/**
 * Pixels per day — wide enough to print the date inside it.
 *
 * Every day carries its own number, so the column has to fit two digits and
 * still be separable from its neighbour. That makes the chart wide: a
 * seven-month project runs to roughly 4,600px, which is why the chart scrolls
 * horizontally rather than trying to compress a calendar into a card.
 */
const DAY_WIDTH = 22;
const DAY_MS = 86_400_000;

const toDayStart = (value: Date) => {
  const copy = new Date(value);
  copy.setHours(0, 0, 0, 0);
  return copy;
};

const toInputDate = (iso: string | null) => (iso ? iso.slice(0, 10) : '');

/** A date input hands back YYYY-MM-DD; the contract wants a datetime. */
const fromInputDate = (value: string) => (value ? `${value}T00:00:00.000Z` : null);

const formatDay = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
    : '—';

interface DraftTask {
  startsAt: string | null;
  endsAt: string | null;
  progressPercent: number;
  actualStartsAt: string | null;
  actualEndsAt: string | null;
}

/**
 * The project schedule as a Gantt chart.
 *
 * The rows are the mandays task list, so the estimate and the schedule can
 * never drift into two different breakdowns of the same project. The left half
 * is the editable table; the right half draws the same numbers, because a bar
 * is easier to compare against its neighbours than two dates are.
 */
export function TimelineView({ timeline }: { timeline: ProjectTimelineView }) {
  const router = useRouter();

  const [window, setWindow] = useState({
    startsAt: timeline.startsAt,
    goLiveAt: timeline.goLiveAt,
  });
  const [drafts, setDrafts] = useState<Record<string, DraftTask>>(() =>
    Object.fromEntries(
      timeline.tasks.map((task) => [
        task.id,
        {
          startsAt: task.startsAt,
          endsAt: task.endsAt,
          progressPercent: task.progressPercent,
          actualStartsAt: task.actualStartsAt,
          actualEndsAt: task.actualEndsAt,
        },
      ]),
    ),
  );
  const [dirty, setDirty] = useState(false);
  const [collapsed, setCollapsed] = useState<ProjectStage[]>([]);

  const editable = timeline.canEdit;

  /** Set, not list: the chart asks "is this day a holiday" once per column. */
  const holidays = useMemo(
    () => new Set(timeline.holidays.map((holiday) => holiday.date)),
    [timeline.holidays],
  );

  const holidayNames = useMemo(
    () => new Map(timeline.holidays.map((holiday) => [holiday.date, holiday.name])),
    [timeline.holidays],
  );

  const workingDays = useCallback(
    (from: string | null, to: string | null) => workingDaysBetween(from, to, holidays),
    [holidays],
  );

  /** The task list with unsaved edits applied — what both halves render from. */
  const tasks = useMemo<TimelineTaskView[]>(
    () => timeline.tasks.map((task) => ({ ...task, ...drafts[task.id] })),
    [timeline.tasks, drafts],
  );

  const byStage = useMemo(
    () =>
      PROJECT_STAGES.map((stage) => ({
        stage,
        tasks: tasks.filter((task) => task.stage === stage),
      })).filter((group) => group.tasks.length > 0),
    [tasks],
  );

  /**
   * The chart's horizontal extent: the project window and every dated task.
   *
   * It begins on the earliest date there is, not on the first of that month.
   * Padding out to whole months put a run of empty columns in front of every
   * project — a schedule starting on the 23rd opened with three weeks of
   * nothing, and the reader had to scroll past them to find the work.
   */
  const scale = useMemo(() => {
    const stamps: number[] = [];
    for (const iso of [window.startsAt, window.goLiveAt]) {
      if (iso) stamps.push(Date.parse(iso));
    }
    for (const task of tasks) {
      if (task.startsAt) stamps.push(Date.parse(task.startsAt));
      if (task.endsAt) stamps.push(Date.parse(task.endsAt));
      if (task.actualStartsAt) stamps.push(Date.parse(task.actualStartsAt));
      if (task.actualEndsAt) stamps.push(Date.parse(task.actualEndsAt));
    }

    const today = toDayStart(new Date()).getTime();
    if (stamps.length === 0) stamps.push(today, today + 30 * DAY_MS);

    // Normalised to midnight so a task stored with a time does not shift the
    // whole grid by a fraction of a column.
    const start = toDayStart(new Date(Math.min(...stamps)));
    const end = toDayStart(new Date(Math.max(...stamps)));

    const totalDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1);

    const months: { key: string; label: string; days: number }[] = [];
    const cursor = new Date(start);
    while (cursor <= end) {
      const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
      const from = cursor > start ? cursor : start;
      const to = monthEnd < end ? monthEnd : end;
      months.push({
        key: `${cursor.getFullYear()}-${cursor.getMonth()}`,
        label: cursor.toLocaleDateString('id-ID', { month: 'short', year: 'numeric' }),
        days: Math.round((to.getTime() - from.getTime()) / DAY_MS) + 1,
      });
      cursor.setMonth(cursor.getMonth() + 1, 1);
    }

    /**
     * One tick per calendar day, each labelled with its own date.
     *
     * Every day is listed rather than every week, so a bar's edge lands on the
     * date it actually starts instead of somewhere between two markers the
     * reader has to count from.
     *
     * The non-working flag is what makes the Work Days column visible in the
     * chart: a bar crossing tinted columns is spanning days nobody works,
     * which is exactly the gap between "Days" and "Work Days". Weekends and
     * public holidays are both marked, and marked the same, because the
     * schedule steps over both for the same reason.
     */
    const days: {
      key: string;
      offset: number;
      label: string;
      offDay: boolean;
      holidayName: string | null;
      firstOfMonth: boolean;
    }[] = [];

    const dayCursor = new Date(start);
    for (let offset = 0; offset < totalDays; offset += 1) {
      const weekday = dayCursor.getDay();
      const month = `${dayCursor.getMonth() + 1}`.padStart(2, '0');
      const day = `${dayCursor.getDate()}`.padStart(2, '0');
      const isoKey = `${dayCursor.getFullYear()}-${month}-${day}`;
      const isHoliday = holidays.has(isoKey);

      days.push({
        key: isoKey,
        offset,
        label: String(dayCursor.getDate()),
        offDay: weekday === 0 || weekday === 6 || isHoliday,
        holidayName: isHoliday ? (holidayNames.get(isoKey) ?? 'Hari libur') : null,
        firstOfMonth: dayCursor.getDate() === 1,
      });
      dayCursor.setDate(dayCursor.getDate() + 1);
    }

    return { start, totalDays, months, days, width: totalDays * DAY_WIDTH };
  }, [tasks, window, holidays, holidayNames]);

  /** Offset and length of one bar, or null when the task has no dates yet. */
  function barGeometry(startsAt: string | null, endsAt: string | null) {
    if (!startsAt || !endsAt) return null;
    const offset = Math.round((Date.parse(startsAt) - scale.start.getTime()) / DAY_MS);
    const span = Math.max(1, calendarDays(startsAt, endsAt) ?? 1);
    return { left: offset * DAY_WIDTH, width: span * DAY_WIDTH };
  }

  const todayOffset = Math.round(
    (toDayStart(new Date()).getTime() - scale.start.getTime()) / DAY_MS,
  );
  const todayVisible = todayOffset >= 0 && todayOffset <= scale.totalDays;

  /**
   * Opens the chart on today rather than on the project's first day.
   *
   * A project that began in March has months of finished work in front of it,
   * and the reader arriving in September wants what is happening now — they
   * were scrolling past the same dead columns on every visit.
   *
   * The scroll is the day's offset alone, not offset plus the table's width:
   * the task table is `sticky left-0`, so it covers the first 48rem of the
   * viewport whatever the scroll is, and the chart column under it is hidden
   * rather than pushed along.
   *
   * It re-runs when the chart's first day moves — recalculating from the
   * estimate can redraw the whole range, and a scroll position measured
   * against the old start points at the wrong date. It does not re-run on
   * ordinary edits, so it never yanks the view out from under a reader who
   * has scrolled somewhere deliberately.
   */
  const chartRef = useRef<HTMLDivElement>(null);
  const scaleStart = scale.start.getTime();

  useEffect(() => {
    const container = chartRef.current;
    if (!container || !todayVisible) return;
    // Clamped by the browser, so a chart narrower than the viewport stays put.
    container.scrollLeft = todayOffset * DAY_WIDTH;
  }, [scaleStart, todayOffset, todayVisible]);

  /** Tasks whose actual end landed after their planned end. */
  const lateCount = tasks.filter(isFinishedLate).length;

  const overallProgress =
    tasks.length === 0
      ? 0
      : Math.round(tasks.reduce((sum, task) => sum + task.progressPercent, 0) / tasks.length);

  /**
   * Re-lays every task from the project start, in stage then position order.
   *
   * The durations come from the mandays estimate — this is the translation the
   * brief asks for, and it is why the estimate has to exist before a schedule
   * can. Manual edits are deliberately discarded: the button says it will
   * recalculate, and half-honouring that would leave a schedule nobody could
   * explain.
   */
  function recalculate(from: string | null) {
    if (!from) return;

    const parents = new Set(
      timeline.tasks.map((task) => task.parentId).filter((id): id is string => id !== null),
    );

    // Only leaves are scheduled. A parent is a roll-up of the work under it —
    // giving it a slot of its own would lay the same days down twice and push
    // the whole project out by the size of its own breakdown.
    const ordered = [...timeline.tasks]
      .filter((task) => !parents.has(task.id))
      .sort(
        (a, b) =>
          PROJECT_STAGES.indexOf(a.stage) - PROJECT_STAGES.indexOf(b.stage) ||
          a.position - b.position,
      );

    const scheduled = scheduleSequentially(
      ordered.map((task) => ({ id: task.id, days: task.estimatedDays })),
      from,
      holidays,
    );

    // A parent then spans its children, so its bar still reads as the period
    // that breakdown covers rather than disappearing from the chart.
    for (const parentId of parents) {
      const childDates = timeline.tasks
        .filter((task) => task.parentId === parentId)
        .map((task) => scheduled[task.id])
        .filter((dates): dates is NonNullable<typeof dates> => Boolean(dates));

      if (childDates.length === 0) continue;

      scheduled[parentId] = {
        startsAt: childDates.map((dates) => dates.startsAt).sort()[0]!,
        endsAt: childDates
          .map((dates) => dates.endsAt)
          .sort()
          .at(-1)!,
      };
    }

    setDirty(true);
    setDrafts((current) => {
      const next = { ...current };
      // Every task, not only the scheduled ones. A task the estimate does not
      // cover any more has to lose its dates: leaving yesterday's run in place
      // would show a bar for work the plan says takes no time, and no button
      // on this screen would ever clear it.
      for (const task of timeline.tasks) {
        const dates = scheduled[task.id] ?? null;
        next[task.id] = {
          ...current[task.id]!,
          startsAt: dates?.startsAt ?? null,
          endsAt: dates?.endsAt ?? null,
        };
      }
      return next;
    });
  }

  function editTask(id: string, patch: Partial<DraftTask>) {
    setDirty(true);
    setDrafts((current) => ({ ...current, [id]: { ...current[id]!, ...patch } }));
  }

  function toggleStage(stage: ProjectStage) {
    setCollapsed((current) =>
      current.includes(stage)
        ? current.filter((candidate) => candidate !== stage)
        : [...current, stage],
    );
  }

  const save = useMutation({
    mutationFn: () =>
      clientFetch<ProjectTimelineView>(`/workspace/projects/${timeline.projectId}/timeline`, {
        method: 'PUT',
        body: {
          startsAt: window.startsAt,
          goLiveAt: window.goLiveAt,
          tasks: timeline.tasks.map((task) => ({ id: task.id, ...drafts[task.id]! })),
          expectedUpdatedAt: timeline.updatedAt,
        },
      }),
    onSuccess: () => {
      setDirty(false);
      toast.success('Timeline berhasil disimpan.');
      router.refresh();
    },
  });

  const [exporting, setExporting] = useState(false);

  /**
   * Downloads what is on screen — unsaved edits included, and every stage
   * whether or not it is collapsed, since collapsing is a reading aid and not
   * a filter. The writer is imported here so it only loads on demand.
   */
  async function downloadExcel() {
    setExporting(true);
    try {
      const { exportTimeline } = await import('./timeline-export');

      await exportTimeline({
        projectName: timeline.projectName,
        stageLabel: PROJECT_STAGE_LABELS[timeline.stage],
        startsAt: window.startsAt,
        goLiveAt: window.goLiveAt,
        overallProgress,
        months: scale.months.map(({ label, days }) => ({ label, days })),
        days: scale.days.map(({ key, label, offDay }) => ({ key, label, offDay })),
        stages: byStage.map(({ stage, tasks: stageTasks }) => {
          const starts = stageTasks.map((task) => task.startsAt).filter(Boolean) as string[];
          const ends = stageTasks.map((task) => task.endsAt).filter(Boolean) as string[];
          const from = starts.length > 0 ? starts.slice().sort()[0]! : null;
          const to = ends.length > 0 ? ends.slice().sort().at(-1)! : null;
          const actualStarts = stageTasks
            .map((task) => task.actualStartsAt)
            .filter(Boolean) as string[];
          const actualFrom = actualStarts.length > 0 ? actualStarts.slice().sort()[0]! : null;
          const actuals = stageTasks.map((task) => task.actualEndsAt);
          const actualTo = actuals.every(Boolean)
            ? (actuals as string[]).slice().sort().at(-1)!
            : null;

          return {
            stage,
            label: PROJECT_STAGE_LABELS[stage],
            startsAt: from,
            endsAt: to,
            actualStartsAt: actualFrom,
            actualEndsAt: actualTo,
            days: calendarDays(from, to) ?? 0,
            progressPercent: stageProgress(stageTasks),
            workDays:
              workingDays(
                actualFrom && actualTo ? actualFrom : from,
                actualFrom && actualTo ? actualTo : to,
              ) ?? 0,
            tasks: stageTasks.map((task) => ({
              name: task.name,
              startsAt: task.startsAt,
              endsAt: task.endsAt,
              actualStartsAt: task.actualStartsAt,
              actualEndsAt: task.actualEndsAt,
              estimatedDays: task.estimatedDays,
              progressPercent: task.progressPercent,
              workDays:
                workingDays(
                  task.actualStartsAt && task.actualEndsAt ? task.actualStartsAt : task.startsAt,
                  task.actualStartsAt && task.actualEndsAt ? task.actualEndsAt : task.endsAt,
                ) ?? 0,
              late: isFinishedLate(task),
            })),
          };
        }),
      });

      toast.success('Excel diunduh.');
    } catch {
      toast.error('Excel gagal dibuat.');
    } finally {
      setExporting(false);
    }
  }

  const exportButton = (
    <Button
      variant="outline"
      leftIcon={<Download className="h-4 w-4" aria-hidden />}
      loading={exporting}
      disabled={tasks.length === 0 || exporting}
      onClick={() => void downloadExcel()}
    >
      Export Excel
    </Button>
  );

  const error =
    save.error instanceof ApiClientError
      ? save.error.message
      : save.error
        ? 'Timeline gagal disimpan.'
        : null;

  return (
    <div className="space-y-4">
      {error && <Alert tone="danger">{error}</Alert>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<CircleCheck className="h-5 w-5" aria-hidden />}
          label="Task terjadwal"
          value={`${tasks.filter((task) => task.startsAt && task.endsAt).length} / ${tasks.length}`}
          note={
            lateCount > 0 ? (
              <span className="font-medium text-red-600">{lateCount} selesai terlambat</span>
            ) : (
              'Tidak ada yang terlambat'
            )
          }
        />
        <StatCard
          icon={<Layers className="h-5 w-5" aria-hidden />}
          label="Tahapan berjalan"
          value={PROJECT_STAGE_LABELS[timeline.stage]}
        />
        <StatCard
          icon={<CalendarRange className="h-5 w-5" aria-hidden />}
          label="Rentang project"
          value={`${formatDay(window.startsAt)} – ${formatDay(window.goLiveAt)}`}
          small
        />
        <StatCard
          icon={<TrendingUp className="h-5 w-5" aria-hidden />}
          label="Progress keseluruhan"
          value={`${overallProgress}%`}
        />
      </div>

      <Card className="overflow-hidden">
        <CardHeader
          title="Project Timeline"
          description="Jadwal dihitung atas task yang sama dengan estimasi mandays."
          icon={<CalendarRange className="h-4 w-4" aria-hidden />}
          tinted
          action={
            editable ? (
              <div className="flex flex-wrap items-end gap-3">
                <WindowField
                  label="Start"
                  value={window.startsAt}
                  onChange={(value) => {
                    setDirty(true);
                    setWindow((current) => ({ ...current, startsAt: value }));
                    // Moving the start is the one edit that redraws everything.
                    recalculate(value);
                  }}
                />
                <WindowField
                  label="Go Live"
                  value={window.goLiveAt}
                  onChange={(value) => {
                    setDirty(true);
                    setWindow((current) => ({ ...current, goLiveAt: value }));
                  }}
                />
                <Button
                  variant="outline"
                  leftIcon={<Wand2 className="h-4 w-4" aria-hidden />}
                  disabled={!window.startsAt}
                  title="Susun ulang semua task dari tanggal mulai, memakai estimasi mandays"
                  onClick={() => recalculate(window.startsAt)}
                >
                  Hitung dari mandays
                </Button>
                <Button
                  leftIcon={<Save className="h-4 w-4" aria-hidden />}
                  loading={save.isPending}
                  disabled={save.isPending}
                  title={dirty ? 'Simpan perubahan timeline' : 'Belum ada perubahan'}
                  onClick={() => {
                    if (!dirty) {
                      toast.info('Belum ada perubahan untuk disimpan.');
                      return;
                    }
                    save.mutate();
                  }}
                >
                  Simpan
                </Button>
                {exportButton}
              </div>
            ) : (
              exportButton
            )
          }
        />

        {/*
          One scroll container for both halves: the table is sticky at the left
          edge so a row's name stays readable while its bar is scrolled to.
        */}
        <div ref={chartRef} className="overflow-x-auto">
          <div className="flex min-w-max">
            <div className="sticky left-0 z-10 w-[48rem] shrink-0 border-r border-slate-200 bg-white">
              {/*
                Column order matches the reference schedule: the two day
                counts are separated by % Done, so the elapsed span and the
                working span are read as different questions rather than as a
                pair to be compared digit by digit.
              */}
              <div className="flex h-14 items-end border-b border-slate-200 bg-slate-50 px-3 pb-2 text-xs font-semibold text-slate-700">
                <span className="flex-1">Task Name</span>
                <span className="w-24">Start</span>
                <span className="w-24">End</span>
                <span className="w-24" title="Tanggal task benar-benar dimulai">
                  Actual Start
                </span>
                <span className="w-24" title="Tanggal task benar-benar selesai">
                  Actual End
                </span>
                <span className="w-12 text-right" title="Total mandays dari estimasi">
                  Days
                </span>
                <span className="w-16 text-right">% Done</span>
                <span className="w-20 text-right" title="Working days, weekends excluded">
                  Work Days
                </span>
              </div>

              {byStage.map(({ stage, tasks: stageTasks }) => {
                const isCollapsed = collapsed.includes(stage);
                const starts = stageTasks.map((task) => task.startsAt).filter(Boolean) as string[];
                const ends = stageTasks.map((task) => task.endsAt).filter(Boolean) as string[];
                const from = starts.length > 0 ? starts.slice().sort()[0]! : null;
                const to = ends.length > 0 ? ends.slice().sort().at(-1)! : null;
                const actualStarts = stageTasks
                  .map((task) => task.actualStartsAt)
                  .filter(Boolean) as string[];
                const actualFrom = actualStarts.length > 0 ? actualStarts.slice().sort()[0]! : null;
                // The stage finished only when every one of its tasks has.
                const actuals = stageTasks.map((task) => task.actualEndsAt);
                const actualTo = actuals.every(Boolean)
                  ? (actuals as string[]).slice().sort().at(-1)!
                  : null;

                return (
                  <div key={stage}>
                    <button
                      type="button"
                      onClick={() => toggleStage(stage)}
                      aria-expanded={!isCollapsed}
                      title={`${isCollapsed ? 'Tampilkan' : 'Sembunyikan'} task ${PROJECT_STAGE_LABELS[stage]}`}
                      className={cn(
                        'flex h-9 w-full items-center px-3 text-left text-xs font-semibold text-slate-800 transition-colors hover:brightness-95',
                        STAGE_ROW[stage],
                      )}
                    >
                      <span className="flex min-w-0 flex-1 items-center gap-1.5">
                        {isCollapsed ? (
                          <ChevronRight
                            className="h-3.5 w-3.5 shrink-0 text-slate-500"
                            aria-hidden
                          />
                        ) : (
                          <ChevronDown
                            className="h-3.5 w-3.5 shrink-0 text-slate-500"
                            aria-hidden
                          />
                        )}
                        <span className="truncate">{PROJECT_STAGE_LABELS[stage]}</span>
                      </span>
                      <span className="w-24">{formatDay(from)}</span>
                      <span className="w-24">{formatDay(to)}</span>
                      <span className="w-24">{formatDay(actualFrom)}</span>
                      <span className="w-24">{formatDay(actualTo)}</span>
                      <span className="w-12 text-right">{calendarDays(from, to) ?? 0}</span>
                      <span className="w-16 text-right">{stageProgress(stageTasks)}%</span>
                      <span className="w-20 text-right">
                        {workingDays(
                          actualFrom && actualTo ? actualFrom : from,
                          actualFrom && actualTo ? actualTo : to,
                        ) ?? 0}
                      </span>
                    </button>

                    {!isCollapsed &&
                      stageTasks.map((task) => (
                        <div
                          key={task.id}
                          className="flex h-9 items-center border-b border-slate-100 px-3 text-xs"
                        >
                          <span className="flex-1 truncate pl-3 text-slate-700" title={task.name}>
                            {task.name}
                          </span>
                          <DateCell
                            value={task.startsAt}
                            editable={editable}
                            label={`Start ${task.name}`}
                            onChange={(value) => editTask(task.id, { startsAt: value })}
                          />
                          <DateCell
                            value={task.endsAt}
                            editable={editable}
                            label={`End ${task.name}`}
                            onChange={(value) => editTask(task.id, { endsAt: value })}
                          />
                          <DateCell
                            value={task.actualStartsAt}
                            editable={editable}
                            label={`Actual Start ${task.name}`}
                            onChange={(value) => editTask(task.id, { actualStartsAt: value })}
                          />
                          <DateCell
                            value={task.actualEndsAt}
                            editable={editable}
                            label={`Actual End ${task.name}`}
                            late={isFinishedLate(task)}
                            onChange={(value) => editTask(task.id, { actualEndsAt: value })}
                          />
                          {/* The estimate this row was scheduled from, so a
                              bar that no longer matches its estimate shows. */}
                          <span className="w-12 text-right text-slate-500">
                            {task.estimatedDays}
                          </span>
                          <span className="w-16 text-right">
                            {editable ? (
                              <input
                                type="number"
                                min={0}
                                max={100}
                                step={5}
                                value={task.progressPercent}
                                aria-label={`Progress ${task.name}`}
                                onChange={(event) =>
                                  editTask(task.id, {
                                    progressPercent: Math.min(
                                      100,
                                      Math.max(0, Number(event.target.value) || 0),
                                    ),
                                  })
                                }
                                className="w-14 rounded border border-slate-300 px-1 py-0.5 text-right text-xs"
                              />
                            ) : (
                              `${task.progressPercent}%`
                            )}
                          </span>
                          <span className="w-20 text-right text-slate-500">
                            {workingDays(
                              task.actualStartsAt && task.actualEndsAt
                                ? task.actualStartsAt
                                : task.startsAt,
                              task.actualStartsAt && task.actualEndsAt
                                ? task.actualEndsAt
                                : task.endsAt,
                            ) ?? 0}
                          </span>
                        </div>
                      ))}
                  </div>
                );
              })}
            </div>

            <div className="relative" style={{ width: scale.width }}>
              <div className="flex h-8 border-b border-slate-200 bg-slate-50">
                {scale.months.map((month) => (
                  <div
                    key={month.key}
                    style={{ width: month.days * DAY_WIDTH }}
                    className="overflow-hidden border-r border-slate-200 px-2 text-[11px] leading-8 font-medium whitespace-nowrap text-slate-600"
                  >
                    {month.label}
                  </div>
                ))}
              </div>
              {/* The date row: every calendar day, each carrying its number. */}
              <div className="relative h-6 border-b border-slate-200 bg-slate-50">
                {scale.days.map((day) => (
                  <span
                    key={day.key}
                    className={cn(
                      'absolute top-0 text-center text-[10px] leading-6 tabular-nums',
                      day.offDay ? 'bg-red-50 font-medium text-red-600' : 'text-slate-500',
                    )}
                    title={day.holidayName ?? undefined}
                    style={{ left: day.offset * DAY_WIDTH, width: DAY_WIDTH }}
                  >
                    {day.label}
                  </span>
                ))}
              </div>

              {/*
                One column per day under the bars, matching the labels above.
                Non-working days are tinted red rather than merely ruled: it
                is what makes the difference between the Days and Work Days
                columns visible in the chart instead of only in the table.
              */}
              {scale.days.map((day) => (
                <div
                  key={`grid-${day.key}`}
                  aria-hidden
                  className={cn(
                    'pointer-events-none absolute top-14 bottom-0 border-l',
                    day.firstOfMonth ? 'border-slate-300' : 'border-slate-100',
                    day.offDay && 'bg-red-50/70',
                  )}
                  style={{ left: day.offset * DAY_WIDTH, width: DAY_WIDTH }}
                />
              ))}

              {todayVisible && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute top-8 bottom-0 z-[5] w-px bg-red-400"
                  style={{ left: todayOffset * DAY_WIDTH }}
                />
              )}

              {byStage.map(({ stage, tasks: stageTasks }) => {
                const isCollapsed = collapsed.includes(stage);
                const starts = stageTasks.map((task) => task.startsAt).filter(Boolean) as string[];
                const ends = stageTasks.map((task) => task.endsAt).filter(Boolean) as string[];
                const summary = barGeometry(
                  starts.length > 0 ? starts.slice().sort()[0]! : null,
                  ends.length > 0 ? ends.slice().sort().at(-1)! : null,
                );

                return (
                  <div key={stage}>
                    <div className={cn('relative h-9', STAGE_ROW[stage])}>
                      {summary && (
                        <span
                          className="absolute top-3 h-3 rounded-full opacity-40"
                          style={{ ...summary, backgroundColor: STAGE_FILL[stage] }}
                        />
                      )}
                    </div>

                    {!isCollapsed &&
                      stageTasks.map((task) => {
                        const bar = barGeometry(task.startsAt, task.endsAt);
                        // The days past the planned end, drawn as a red tail
                        // so the overrun is measurable against the calendar.
                        const overrun =
                          bar && isFinishedLate(task)
                            ? barGeometry(
                                new Date(Date.parse(task.endsAt!) + DAY_MS).toISOString(),
                                task.actualEndsAt,
                              )
                            : null;
                        return (
                          <div key={task.id} className="relative h-9 border-b border-slate-100">
                            {overrun && (
                              <span
                                title={`Terlambat: selesai ${formatDay(task.actualEndsAt)}, rencana ${formatDay(task.endsAt)}`}
                                className="absolute top-2.5 h-4 rounded-r-full bg-red-400/80"
                                style={overrun}
                              />
                            )}
                            {bar && (
                              <span
                                title={`${task.name}: ${formatDay(task.startsAt)} – ${formatDay(task.endsAt)} (${task.progressPercent}%)`}
                                className="absolute top-2.5 h-4 overflow-hidden rounded-full"
                                style={{ ...bar, backgroundColor: STAGE_FILL[stage] }}
                              >
                                {/* Progress is drawn inside the bar, so a late
                                    task is visible as an unfilled tail. */}
                                <span
                                  className="block h-full bg-black/25"
                                  style={{ width: `${task.progressPercent}%` }}
                                />
                              </span>
                            )}
                          </div>
                        );
                      })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {tasks.length === 0 && (
          <p className="px-5 py-6 text-sm text-slate-500">
            Belum ada task. Task timeline berasal dari estimasi mandays project ini.
          </p>
        )}
      </Card>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  note,
  small = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  note?: React.ReactNode;
  small?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-600">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-xs text-slate-500">{label}</p>
        <p className={cn('font-bold text-slate-900', small ? 'text-sm' : 'text-lg')}>{value}</p>
        {note && <p className="text-xs text-slate-500">{note}</p>}
      </div>
    </div>
  );
}

function WindowField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  return (
    <label className="text-xs text-slate-500">
      <span className="block">{label}</span>
      <input
        type="date"
        value={toInputDate(value)}
        onChange={(event) => onChange(fromInputDate(event.target.value))}
        className="mt-0.5 rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-900"
      />
    </label>
  );
}

function DateCell({
  value,
  editable,
  label,
  late = false,
  onChange,
}: {
  value: string | null;
  editable: boolean;
  label: string;
  /** Marks an actual end that landed after the planned one. */
  late?: boolean;
  onChange: (value: string | null) => void;
}) {
  const title = late ? 'Selesai melewati tanggal End' : undefined;

  if (!editable) {
    return (
      <span
        className={cn('w-24', late ? 'font-semibold text-red-600' : 'text-slate-500')}
        title={title}
      >
        {formatDay(value)}
      </span>
    );
  }

  return (
    <input
      type="date"
      value={toInputDate(value)}
      aria-label={label}
      title={title}
      onChange={(event) => onChange(fromInputDate(event.target.value))}
      className={cn(
        'w-24 rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-slate-700 hover:border-slate-300 focus:border-slate-300',
        late && 'bg-red-50 font-semibold text-red-600',
      )}
    />
  );
}
