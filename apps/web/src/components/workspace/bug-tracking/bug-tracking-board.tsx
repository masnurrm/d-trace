'use client';

import { useMutation } from '@tanstack/react-query';
import {
  Bug,
  CalendarRange,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Download,
  FlaskConical,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Fragment, useMemo, useState } from 'react';
import {
  BUG_ENVIRONMENTS,
  BUG_ENVIRONMENT_LABELS,
  BUG_NEXT_STEPS,
  BUG_SEVERITIES,
  BUG_SEVERITY_LABELS,
  BUG_STATUSES,
  BUG_STATUS_LABELS,
  type BugSeverity,
  type BugStatus,
  type BugView,
  type ProjectBugsView,
} from '@dtrace/shared';
import { ApiClientError, clientFetch } from '@/lib/api/client';
import { useUrlFilters } from '@/lib/query/use-url-filters';
import { useLocalTimeZone } from '@/lib/utils/use-local-time-zone';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { DropdownMenu, type MenuAction } from '@/components/ui/dropdown-menu';
import { PageHeader } from '@/components/ui/page-header';
import { SelectControl, TextField } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { cn } from '@/lib/utils/cn';
import { BugDialog } from './bug-dialog';
import {
  BUG_STATUS_STYLE,
  ENVIRONMENT_STYLE,
  ENV_ALL,
  SEVERITY_STYLE,
  addDays,
  dayIn,
  daysBetween,
  formatDay,
  instantDay,
  isOverdue,
  spanOf,
  storedDay,
  type EnvironmentFilter,
} from './bug-style';

const CELL = 'border border-slate-200 dark:border-slate-700';

/** Two weeks: enough to see a fix through QA, narrow enough to read a day. */
const TIMELINE_DAYS = 14;
/** Days of history shown before today when the timeline opens. */
const LEAD_DAYS = 3;

type GroupBy = 'developer' | 'qa' | 'module';

const GROUP_BY_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: 'developer', label: 'Developer' },
  { value: 'qa', label: 'QA PIC' },
  { value: 'module', label: 'Modul' },
];

/** Behind a group's header row, so groups separate while scrolling. */
const GROUP_TINTS = [
  'bg-blue-50/70 dark:bg-blue-950/40',
  'bg-emerald-50/70 dark:bg-emerald-950/40',
  'bg-rose-50/70 dark:bg-rose-950/40',
  'bg-amber-50/70 dark:bg-amber-950/40',
  'bg-violet-50/70 dark:bg-violet-950/40',
  'bg-cyan-50/70 dark:bg-cyan-950/40',
];

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || '?';

interface Group {
  key: string;
  label: string;
  /** No developer, no QA, no module: sorts last and reads as a gap to fill. */
  unassigned: boolean;
  bugs: BugView[];
}

function groupBugs(bugs: BugView[], by: GroupBy): Group[] {
  const pick = (bug: BugView): { key: string | null; label: string | null } =>
    by === 'developer'
      ? { key: bug.developerId, label: bug.developerName }
      : by === 'qa'
        ? { key: bug.qaId, label: bug.qaName }
        : { key: bug.module, label: bug.module };

  const empty =
    by === 'developer' ? 'Belum ditugaskan' : by === 'qa' ? 'Belum ada QA' : 'Tanpa modul';

  const groups = new Map<string, Group>();
  for (const bug of bugs) {
    const { key, label } = pick(bug);
    const id = key ?? '';
    const group = groups.get(id) ?? {
      key: id,
      label: key ? (label ?? 'Pengguna lain') : empty,
      unassigned: key === null,
      bugs: [],
    };
    group.bugs.push(bug);
    groups.set(id, group);
  }

  return [...groups.values()].sort((a, b) =>
    a.unassigned !== b.unassigned ? (a.unassigned ? 1 : -1) : a.label.localeCompare(b.label),
  );
}

export interface BugTrackingBoardProps {
  projectId: string;
  projectName: string;
  data: ProjectBugsView;
  /** From `?env=`; null means "use the environment the project has reached". */
  requestedEnvironment: EnvironmentFilter | null;
  members: { userId: string; name: string }[];
  can: { create: boolean; update: boolean; delete: boolean };
}

/**
 * The Bug & Issue list: every bug the project has recorded, per environment,
 * grouped by who is fixing it, with each one's span drawn on a two-week
 * timeline and the ones waiting on QA gathered underneath.
 *
 * The list is loaded whole, so the environment switch, the filters, the
 * counters and the export all agree without another round trip.
 *
 * **The environment filter starts where the project is.** A project that has
 * gone live opens on Production, because once it is live that is where the
 * bugs that matter are being found; one still in user testing opens on UAT.
 * Which one, and why, comes from the API (`reachedEnvironment()` in the
 * contract) and is printed beside the switch, so the default is never a
 * mystery. `?env=` overrides it, and choosing another environment writes it
 * there, so a refresh or a shared link shows the same slice.
 *
 * The layout: the left half is a normal table and the right half is one cell
 * per row holding a 14-column grid. Rows line up with the date header for
 * free, instead of two scroll areas that have to be kept in step by hand.
 */
export function BugTrackingBoard({
  projectId,
  projectName,
  data,
  requestedEnvironment,
  members,
  can,
}: BugTrackingBoardProps) {
  const router = useRouter();
  const { setFilters } = useUrlFilters();
  const timeZone = useLocalTimeZone();
  const today = dayIn(new Date(), timeZone);

  const [environment, setEnvironment] = useState<EnvironmentFilter>(
    requestedEnvironment ?? data.environment,
  );
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [severity, setSeverity] = useState('');
  const [module, setModule] = useState('');
  const [groupBy, setGroupBy] = useState<GroupBy>('developer');
  const [collapsed, setCollapsed] = useState<string[]>([]);

  // An offset rather than a date, so "today" can resolve after hydration
  // without the window having been pinned to the server's idea of it.
  const [shift, setShift] = useState(0);
  const days = useMemo(() => {
    const first = addDays(today, shift - LEAD_DAYS);
    return Array.from({ length: TIMELINE_DAYS }, (_, index) => addDays(first, index));
  }, [today, shift]);

  const [dialog, setDialog] = useState<{ bug: BugView | null } | null>(null);
  const [deleting, setDeleting] = useState<BugView | null>(null);
  const [exporting, setExporting] = useState(false);

  const counts = useMemo(() => {
    const byEnvironment = { [ENV_ALL]: data.bugs.length, SIT: 0, UAT: 0, PROD: 0 };
    for (const bug of data.bugs) byEnvironment[bug.environment] += 1;
    return byEnvironment;
  }, [data.bugs]);

  const inEnvironment = useMemo(
    () =>
      environment === ENV_ALL
        ? data.bugs
        : data.bugs.filter((bug) => bug.environment === environment),
    [data.bugs, environment],
  );

  // Modules come from the data: they are free text and differ per project.
  const modules = useMemo(
    () =>
      [...new Set(data.bugs.map((bug) => bug.module).filter((value): value is string => Boolean(value)))].sort(
        (a, b) => a.localeCompare(b),
      ),
    [data.bugs],
  );

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return inEnvironment.filter((bug) => {
      if (status && bug.status !== status) return false;
      if (severity && bug.severity !== severity) return false;
      if (module && bug.module !== module) return false;
      if (!needle) return true;

      return [bug.code, bug.title, bug.module ?? '', bug.developerName ?? '', bug.qaName ?? '']
        .join(' ')
        .toLowerCase()
        .includes(needle);
    });
  }, [inEnvironment, search, status, severity, module]);

  const groups = useMemo(() => groupBugs(visible, groupBy), [visible, groupBy]);

  // The queue is a work list, so only the environment narrows it: a QA looking
  // for what to test next should not lose a bug to a search typed for another.
  const queue = useMemo(
    () =>
      inEnvironment
        .filter((bug) => bug.status === 'PENDING_TEST' || bug.status === 'IN_QA')
        .sort((a, b) => (a.readyForTestAt ?? '').localeCompare(b.readyForTestAt ?? '')),
    [inEnvironment],
  );

  const tally = (value: BugStatus) => inEnvironment.filter((bug) => bug.status === value).length;
  const overdue = inEnvironment.filter((bug) => isOverdue(bug, today)).length;

  const move = useMutation({
    mutationFn: ({ id, status: next }: { id: string; status: BugStatus }) =>
      clientFetch(`/workspace/bugs/${id}/status`, { method: 'PATCH', body: { status: next } }),
    onSuccess: () => router.refresh(),
  });

  const remove = useMutation({
    mutationFn: (id: string) => clientFetch(`/workspace/bugs/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setDeleting(null);
      router.refresh();
    },
  });

  const error =
    messageOf(move.error, 'Status bug gagal diubah.') ??
    (deleting ? null : messageOf(remove.error, 'Bug gagal dihapus.'));

  function chooseEnvironment(next: EnvironmentFilter) {
    setEnvironment(next);
    // The project's own environment needs no parameter: a bare link should
    // keep following the project as it moves on to the next one.
    setFilters(
      (params) => {
        if (next === data.environment) params.delete('env');
        else params.set('env', next.toLowerCase());
      },
      { replace: true },
    );
  }

  function toggle(key: string) {
    setCollapsed((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );
  }

  function reset() {
    setSearch('');
    setStatus('');
    setSeverity('');
    setModule('');
  }

  /**
   * Exports what is on screen — the environment and the filters in force
   * decide the rows, and are written into the file so it says which slice it is.
   */
  async function exportExcel() {
    const filters = [
      `Environment: ${environment === ENV_ALL ? 'Semua' : BUG_ENVIRONMENT_LABELS[environment]}`,
      search.trim() && `Cari "${search.trim()}"`,
      status && `Status: ${BUG_STATUS_LABELS[status as BugStatus]}`,
      severity && `Severity: ${BUG_SEVERITY_LABELS[severity as BugSeverity]}`,
      module && `Modul: ${module}`,
    ].filter((value): value is string => Boolean(value));

    setExporting(true);
    try {
      const { exportBugsToExcel } = await import('./bug-tracking-export');
      await exportBugsToExcel(visible, { projectName, filters, timeZone });
    } finally {
      setExporting(false);
    }
  }

  function actionsFor(bug: BugView): MenuAction[] {
    return [
      { label: can.update ? 'Ubah' : 'Lihat detail', onSelect: () => setDialog({ bug }) },
      ...(can.update
        ? BUG_NEXT_STEPS[bug.status].map((step) => ({
            label: step.label,
            disabled: move.isPending,
            onSelect: () => move.mutate({ id: bug.id, status: step.to }),
          }))
        : []),
      ...(can.delete
        ? [
            {
              label: 'Hapus',
              danger: true,
              onSelect: () => {
                remove.reset();
                setDeleting(bug);
              },
            },
          ]
        : []),
    ];
  }

  const personHeading = groupBy === 'developer' ? 'QA PIC' : 'Developer';
  const showEnvironment = environment === ENV_ALL;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bug & Issue"
        description="Bug per environment, dari perbaikan developer sampai verifikasi QA."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              leftIcon={<Download className="h-4 w-4" aria-hidden />}
              loading={exporting}
              disabled={visible.length === 0 || exporting}
              onClick={() => void exportExcel()}
            >
              Export Excel
            </Button>
            {can.create && (
              <Button
                leftIcon={<Plus className="h-4 w-4" aria-hidden />}
                onClick={() => setDialog({ bug: null })}
              >
                Tambah Bug
              </Button>
            )}
          </div>
        }
      />

      {error && <Alert tone="danger">{error}</Alert>}

      <Card className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Environment</span>
        <div
          role="radiogroup"
          aria-label="Environment"
          className="inline-flex flex-wrap gap-0.5 rounded-lg border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-700 dark:bg-slate-800/50"
        >
          {([ENV_ALL, ...BUG_ENVIRONMENTS] as const).map((value) => {
            const selected = environment === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => chooseEnvironment(value)}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors',
                  selected
                    ? 'bg-white font-semibold text-slate-900 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-50 dark:ring-slate-700'
                    : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100',
                )}
              >
                {value === ENV_ALL ? 'Semua' : BUG_ENVIRONMENT_LABELS[value]}
                <span className="rounded-full bg-slate-200/70 px-1.5 text-xs tabular-nums text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                  {counts[value]}
                </span>
              </button>
            );
          })}
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Default: <span className="font-semibold">{BUG_ENVIRONMENT_LABELS[data.environment]}</span>{' '}
          — {data.environmentReason}.
        </p>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <SummaryCard
          label="Total Bugs"
          value={inEnvironment.length}
          hint={overdue > 0 ? `${overdue} lewat target` : 'Tidak ada yang lewat target'}
          hintTone={overdue > 0 ? 'text-red-600 dark:text-red-400' : undefined}
          icon={<Bug className="h-5 w-5" aria-hidden />}
          tint="bg-rose-50 text-rose-600 dark:bg-rose-950 dark:text-rose-300"
        />
        <SummaryCard
          label={BUG_STATUS_LABELS.OPEN}
          value={tally('OPEN')}
          hint="Belum mulai diperbaiki"
          icon={<CircleDot className="h-5 w-5" aria-hidden />}
          tint={BUG_STATUS_STYLE.OPEN.tile}
        />
        <SummaryCard
          label={BUG_STATUS_LABELS.IN_PROGRESS}
          value={tally('IN_PROGRESS')}
          hint="Sedang diperbaiki developer"
          icon={<RefreshCw className="h-5 w-5" aria-hidden />}
          tint={BUG_STATUS_STYLE.IN_PROGRESS.tile}
        />
        <SummaryCard
          label={BUG_STATUS_LABELS.PENDING_TEST}
          value={tally('PENDING_TEST')}
          hint="Siap diverifikasi QA"
          icon={<Send className="h-5 w-5" aria-hidden />}
          tint={BUG_STATUS_STYLE.PENDING_TEST.tile}
        />
        <SummaryCard
          label={BUG_STATUS_LABELS.IN_QA}
          value={tally('IN_QA')}
          hint="Sedang diuji QA"
          icon={<FlaskConical className="h-5 w-5" aria-hidden />}
          tint={BUG_STATUS_STYLE.IN_QA.tile}
        />
        <SummaryCard
          label={BUG_STATUS_LABELS.DONE}
          value={tally('DONE')}
          hint="Lolos verifikasi QA"
          icon={<CheckCircle2 className="h-5 w-5" aria-hidden />}
          tint={BUG_STATUS_STYLE.DONE.tile}
        />
      </div>

      <Card className="overflow-hidden">
        <CardHeader
          title="Bug Fixing Tracker"
          description="Dikelompokkan per orang atau modul; batang menunjukkan sejak bug ditemukan sampai targetnya."
          icon={<CalendarRange className="h-4 w-4" aria-hidden />}
          tinted
          action={
            <div className="flex flex-wrap items-center gap-3">
              {BUG_STATUSES.map((value) => (
                <span
                  key={value}
                  className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300"
                >
                  <span className={cn('h-2.5 w-2.5 rounded-full', BUG_STATUS_STYLE[value].dot)} aria-hidden />
                  {BUG_STATUS_LABELS[value]}
                </span>
              ))}
              <span className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                <span className="h-2.5 w-2.5 rounded-full bg-red-500" aria-hidden />
                Lewat target
              </span>
            </div>
          }
        />

        <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <TextField
            label="Cari"
            name="bug-search"
            className="w-64"
            placeholder="Bug ID, judul, modul, atau orang"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Filter
            label="Status"
            value={status}
            onChange={setStatus}
            placeholder="Semua status"
            options={BUG_STATUSES.map((value) => ({
              value,
              label: BUG_STATUS_LABELS[value],
              dot: BUG_STATUS_STYLE[value].dot,
            }))}
          />
          <Filter
            label="Severity"
            value={severity}
            onChange={setSeverity}
            placeholder="Semua severity"
            options={BUG_SEVERITIES.map((value) => ({ value, label: BUG_SEVERITY_LABELS[value] }))}
          />
          <Filter
            label="Modul"
            value={module}
            onChange={setModule}
            placeholder="Semua modul"
            options={modules.map((value) => ({ value, label: value }))}
          />
          <Filter
            label="Kelompokkan"
            value={groupBy}
            onChange={(value) => value && setGroupBy(value as GroupBy)}
            placeholder="Developer"
            clearable={false}
            options={GROUP_BY_OPTIONS}
          />
          <Button
            variant="outline"
            leftIcon={<RotateCcw className="h-4 w-4" aria-hidden />}
            onClick={reset}
          >
            Reset
          </Button>

          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Mundur satu minggu"
              title="Mundur satu minggu"
              onClick={() => setShift((current) => current - 7)}
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </Button>
            <span className="min-w-44 text-center text-xs font-medium text-slate-600 tabular-nums dark:text-slate-300">
              {formatDay(days[0] ?? null)} – {formatDay(days[days.length - 1] ?? null)}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Maju satu minggu"
              title="Maju satu minggu"
              onClick={() => setShift((current) => current + 7)}
            >
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Button>
            <Button variant="outline" size="sm" disabled={shift === 0} onClick={() => setShift(0)}>
              Hari ini
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto px-4 pb-1 pt-4">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-primary text-primary-foreground">
                {['Bug ID', 'Judul', 'Modul', 'Severity', 'Status', 'Fix ETA', personHeading, 'Update', ''].map(
                  (heading, index) => (
                    <th
                      key={`${heading}-${index}`}
                      className="border border-white/25 px-3 py-2 text-left text-xs font-semibold whitespace-nowrap"
                    >
                      {heading}
                    </th>
                  ),
                )}
                <th className="border border-white/25 p-0 align-bottom">
                  <TimelineHeader days={days} today={today} />
                </th>
              </tr>
            </thead>

            <tbody>
              {groups.length === 0 && (
                <tr>
                  <td colSpan={10} className={cn(CELL, 'px-5 py-10 text-center text-slate-500')}>
                    {inEnvironment.length === 0
                      ? environment === ENV_ALL
                        ? 'Belum ada bug di project ini.'
                        : `Belum ada bug di ${BUG_ENVIRONMENT_LABELS[environment]}.`
                      : 'Tidak ada bug yang cocok dengan filter ini.'}
                  </td>
                </tr>
              )}

              {groups.map((group, groupIndex) => {
                const isOpen = !collapsed.includes(group.key);

                return (
                  <Fragment key={group.key}>
                    <tr
                      className={cn(
                        'font-semibold',
                        group.unassigned
                          ? 'bg-slate-50 dark:bg-slate-800/60'
                          : GROUP_TINTS[groupIndex % GROUP_TINTS.length],
                      )}
                    >
                      <td className={cn(CELL, 'px-3 py-2')} colSpan={9}>
                        <button
                          type="button"
                          onClick={() => toggle(group.key)}
                          aria-expanded={isOpen}
                          className="flex items-center gap-2 text-left"
                        >
                          {isOpen ? (
                            <ChevronDown className="h-4 w-4 text-slate-500" aria-hidden />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-slate-500" aria-hidden />
                          )}
                          {groupBy !== 'module' && (
                            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-[10px] font-semibold text-slate-600 ring-1 ring-slate-300 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-600">
                              {group.unassigned ? '?' : initialsOf(group.label)}
                            </span>
                          )}
                          <span className={cn(group.unassigned && 'italic text-slate-500')}>{group.label}</span>
                          <span className="font-normal text-slate-500">({group.bugs.length} bug)</span>
                        </button>
                      </td>
                      <td className={cn(CELL, 'p-0')}>
                        <TimelineTrack days={days} today={today} />
                      </td>
                    </tr>

                    {isOpen &&
                      group.bugs.map((bug) => {
                        const late = isOverdue(bug, today);
                        const person = groupBy === 'developer' ? bug.qaName : bug.developerName;

                        return (
                          <tr key={bug.id} className="bg-white dark:bg-slate-900">
                            <td className={cn(CELL, 'px-3 py-1.5 whitespace-nowrap')}>
                              <button
                                type="button"
                                onClick={() => setDialog({ bug })}
                                className="font-medium text-sky-600 hover:underline"
                              >
                                {bug.code}
                              </button>
                              {showEnvironment && (
                                <Pill className={cn('ml-1.5', ENVIRONMENT_STYLE[bug.environment])}>
                                  {bug.environment}
                                </Pill>
                              )}
                            </td>
                            <td className={cn(CELL, 'max-w-72 px-3 py-1.5')}>{bug.title}</td>
                            <td className={cn(CELL, 'px-3 py-1.5 text-slate-600 dark:text-slate-300')}>
                              {bug.module ?? '—'}
                            </td>
                            <td className={cn(CELL, 'px-3 py-1.5')}>
                              <Pill className={SEVERITY_STYLE[bug.severity]}>
                                {BUG_SEVERITY_LABELS[bug.severity]}
                              </Pill>
                            </td>
                            <td className={cn(CELL, 'px-3 py-1.5')}>
                              <Pill className={BUG_STATUS_STYLE[bug.status].badge}>
                                {BUG_STATUS_LABELS[bug.status]}
                              </Pill>
                            </td>
                            <td
                              className={cn(
                                CELL,
                                'px-3 py-1.5 whitespace-nowrap',
                                late ? 'font-semibold text-red-600 dark:text-red-400' : 'text-slate-600 dark:text-slate-300',
                              )}
                              title={late ? 'Lewat target perbaikan' : undefined}
                            >
                              {bug.fixEta ? formatDay(storedDay(bug.fixEta)) : '—'}
                            </td>
                            <td className={cn(CELL, 'px-3 py-1.5 whitespace-nowrap text-slate-600 dark:text-slate-300')}>
                              {person ?? '—'}
                            </td>
                            <td className={cn(CELL, 'px-3 py-1.5 whitespace-nowrap text-slate-500')}>
                              {formatDay(instantDay(bug.updatedAt, timeZone))}
                            </td>
                            <td className={cn(CELL, 'px-1 py-1')}>
                              <DropdownMenu label={`Aksi untuk ${bug.code}`} actions={actionsFor(bug)} />
                            </td>
                            <td className={cn(CELL, 'p-0')}>
                              <TimelineTrack days={days} today={today} bug={bug} timeZone={timeZone} />
                            </td>
                          </tr>
                        );
                      })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="border-t border-slate-200 px-5 py-3 text-xs text-slate-500 dark:border-slate-700">
          Menampilkan {visible.length} dari {inEnvironment.length} bug
          {environment !== ENV_ALL && ` di ${BUG_ENVIRONMENT_LABELS[environment]}`}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader
          title="QA Verification Queue"
          description="Bug yang sudah diserahkan developer dan menunggu verifikasi, yang paling lama menunggu di atas."
          icon={<FlaskConical className="h-4 w-4" aria-hidden />}
          tinted
          action={<FlowLegend />}
        />

        <div className="overflow-x-auto px-4 pb-4 pt-4">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-primary text-primary-foreground">
                {['Bug ID', 'Judul', 'Developer', 'Modul', 'Severity', 'QA PIC', 'Status', 'Diserahkan', 'Menunggu', 'Aksi'].map(
                  (heading) => (
                    <th
                      key={heading}
                      className="border border-white/25 px-3 py-2 text-left text-xs font-semibold whitespace-nowrap"
                    >
                      {heading}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {queue.length === 0 && (
                <tr>
                  <td colSpan={10} className={cn(CELL, 'px-5 py-8 text-center text-slate-500')}>
                    Tidak ada bug yang menunggu verifikasi QA.
                  </td>
                </tr>
              )}

              {queue.map((bug) => {
                const handedOver = bug.readyForTestAt ? instantDay(bug.readyForTestAt, timeZone) : null;
                const waiting = handedOver ? daysBetween(handedOver, today) : null;
                const busy = move.isPending && move.variables?.id === bug.id;

                return (
                  <tr key={bug.id} className="bg-white dark:bg-slate-900">
                    <td className={cn(CELL, 'px-3 py-2 whitespace-nowrap')}>
                      <button
                        type="button"
                        onClick={() => setDialog({ bug })}
                        className="font-medium text-sky-600 hover:underline"
                      >
                        {bug.code}
                      </button>
                      {showEnvironment && (
                        <Pill className={cn('ml-1.5', ENVIRONMENT_STYLE[bug.environment])}>
                          {bug.environment}
                        </Pill>
                      )}
                    </td>
                    <td className={cn(CELL, 'max-w-72 px-3 py-2')}>{bug.title}</td>
                    <td className={cn(CELL, 'px-3 py-2')}>
                      <Person name={bug.developerName} />
                    </td>
                    <td className={cn(CELL, 'px-3 py-2 text-slate-600 dark:text-slate-300')}>
                      {bug.module ?? '—'}
                    </td>
                    <td className={cn(CELL, 'px-3 py-2')}>
                      <Pill className={SEVERITY_STYLE[bug.severity]}>{BUG_SEVERITY_LABELS[bug.severity]}</Pill>
                    </td>
                    <td className={cn(CELL, 'px-3 py-2')}>
                      <Person name={bug.qaName} />
                    </td>
                    <td className={cn(CELL, 'px-3 py-2')}>
                      <Pill className={BUG_STATUS_STYLE[bug.status].badge}>{BUG_STATUS_LABELS[bug.status]}</Pill>
                    </td>
                    <td className={cn(CELL, 'px-3 py-2 whitespace-nowrap text-slate-600 dark:text-slate-300')}>
                      {formatDay(handedOver)}
                    </td>
                    <td className={cn(CELL, 'px-3 py-2 whitespace-nowrap tabular-nums')}>
                      {waiting === null ? '—' : waiting <= 0 ? 'Hari ini' : `${waiting} hari`}
                    </td>
                    <td className={cn(CELL, 'px-3 py-2')}>
                      {can.update ? (
                        <div className="flex items-center gap-2">
                          {bug.status === 'PENDING_TEST' ? (
                            <Button
                              size="sm"
                              loading={busy}
                              disabled={move.isPending}
                              onClick={() => move.mutate({ id: bug.id, status: 'IN_QA' })}
                            >
                              Mulai testing
                            </Button>
                          ) : (
                            <>
                              <Button
                                size="sm"
                                loading={busy && move.variables?.status === 'DONE'}
                                disabled={move.isPending}
                                onClick={() => move.mutate({ id: bug.id, status: 'DONE' })}
                              >
                                Lolos
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                loading={busy && move.variables?.status === 'IN_PROGRESS'}
                                disabled={move.isPending}
                                title="Kembalikan ke developer"
                                onClick={() => move.mutate({ id: bug.id, status: 'IN_PROGRESS' })}
                              >
                                Gagal
                              </Button>
                            </>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <BugDialog
        open={dialog !== null}
        onClose={() => setDialog(null)}
        projectId={projectId}
        bug={dialog?.bug ?? null}
        environment={environment === ENV_ALL ? data.environment : environment}
        members={members}
        modules={modules}
        canEdit={dialog?.bug ? can.update : can.create}
      />

      <Modal
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        size="sm"
        title={`Hapus ${deleting?.code ?? 'bug'}?`}
        description="Bug hilang dari daftar. Nomornya tidak dipakai ulang, dan isinya tetap tercatat di audit trail."
        footer={
          <>
            <Button variant="outline" onClick={() => setDeleting(null)} disabled={remove.isPending}>
              Batal
            </Button>
            <Button
              variant="destructive"
              loading={remove.isPending}
              onClick={() => deleting && remove.mutate(deleting.id)}
            >
              Hapus
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          {remove.error && (
            <Alert tone="danger">{messageOf(remove.error, 'Bug gagal dihapus.')}</Alert>
          )}
          <p className="text-slate-700 dark:text-slate-200">{deleting?.title}</p>
        </div>
      </Modal>
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

function SummaryCard({
  label,
  value,
  hint,
  hintTone,
  icon,
  tint,
}: {
  label: string;
  value: number;
  hint: string;
  hintTone?: string;
  icon: React.ReactNode;
  tint: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{label}</p>
          <p className="text-3xl font-semibold tabular-nums text-slate-900 dark:text-slate-50">
            {value}
          </p>
          <p className={cn('truncate text-xs', hintTone ?? 'text-slate-500 dark:text-slate-400')}>{hint}</p>
        </div>
        {/* The tile carries the status colour, matching the legend and the bars
            below — the card is the first place a reader learns the mapping. */}
        <span className={cn('rounded-lg p-2', tint)}>{icon}</span>
      </div>
    </Card>
  );
}

function Filter({
  label,
  value,
  onChange,
  placeholder,
  options,
  clearable = true,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  options: { value: string; label: string; dot?: string }[];
  clearable?: boolean;
}) {
  return (
    <div className="w-44">
      <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">{label}</span>
      <SelectControl
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onValueChange={onChange}
        options={options}
        clearable={clearable}
      />
    </div>
  );
}

function Pill({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset',
        className,
      )}
    >
      {children}
    </span>
  );
}

function Person({ name }: { name: string | null }) {
  if (!name) return <span className="text-slate-400">—</span>;
  return (
    <span className="flex items-center gap-2 whitespace-nowrap">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-200">
        {initialsOf(name)}
      </span>
      {name}
    </span>
  );
}

const isWeekend = (day: string) => {
  const weekday = new Date(`${day}T00:00:00.000Z`).getUTCDay();
  return weekday === 0 || weekday === 6;
};

function TimelineHeader({ days, today }: { days: string[]; today: string }) {
  const months = days.reduce<{ month: string; span: number }[]>((groups, day) => {
    const month = new Date(`${day}T00:00:00.000Z`).toLocaleDateString('id-ID', {
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });
    const last = groups[groups.length - 1];
    if (last && last.month === month) last.span += 1;
    else groups.push({ month, span: 1 });
    return groups;
  }, []);

  return (
    <div className="min-w-md">
      <div className="flex border-b border-white/25">
        {months.map((group) => (
          <div
            key={group.month}
            style={{ flexGrow: group.span, flexBasis: 0 }}
            className="truncate px-2 py-1 text-left text-xs font-semibold"
          >
            {group.month}
          </div>
        ))}
      </div>
      <div className="grid" style={{ gridTemplateColumns: `repeat(${days.length}, 1fr)` }}>
        {days.map((day) => {
          const date = new Date(`${day}T00:00:00.000Z`);
          return (
            <div
              key={day}
              className={cn(
                'px-1 py-1 text-center text-[10px] leading-tight',
                isWeekend(day) && 'opacity-70',
                day === today && 'bg-white/20 font-semibold',
              )}
            >
              <div>{date.getUTCDate()}</div>
              <div className="opacity-80">
                {date.toLocaleDateString('id-ID', { weekday: 'short', timeZone: 'UTC' })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A span placed on the window, by column index; null when it falls outside. */
function clip(days: string[], from: string, to: string) {
  const first = days[0];
  const last = days[days.length - 1];
  if (!first || !last || to < first || from > last) return null;

  return {
    from: daysBetween(first, from < first ? first : from),
    to: daysBetween(first, to > last ? last : to),
    cutStart: from < first,
    cutEnd: to > last,
  };
}

/**
 * One row of the chart: a grid of day cells with the bar placed on top by
 * column index.
 *
 * The "today" line is a left border on that one column of every row, rather
 * than an element floating over the table — a floating line has to be kept in
 * step with row heights and scroll position, and this cannot fall out of step.
 *
 * A span that runs past either edge of the window loses its rounded end on
 * that side, so a bar that continues off-screen does not look finished.
 */
function TimelineTrack({
  days,
  today,
  bug,
  timeZone,
}: {
  days: string[];
  today: string;
  bug?: BugView;
  timeZone?: string;
}) {
  const span = bug ? spanOf(bug, today, timeZone) : null;
  const main = span
    ? clip(days, span.start, span.overrunFrom ? addDays(span.overrunFrom, -1) : span.end)
    : null;
  const overrun = span?.overrunFrom ? clip(days, span.overrunFrom, span.end) : null;
  const late = span?.overrunFrom ? daysBetween(addDays(span.overrunFrom, -1), span.end) : 0;

  return (
    <div
      className="relative grid min-w-md items-center"
      style={{ gridTemplateColumns: `repeat(${days.length}, 1fr)` }}
    >
      {days.map((day) => (
        <div
          key={day}
          className={cn(
            'h-8 border-r border-slate-100 last:border-r-0 dark:border-slate-800',
            isWeekend(day) && 'bg-slate-50 dark:bg-slate-800/40',
            day === today && 'border-l-2 border-l-red-500',
          )}
          style={{ gridRow: 1 }}
          aria-hidden
        />
      ))}

      {bug && main && (
        <div
          className={cn(
            'z-10 flex h-6 items-center justify-center truncate px-2 text-[11px] font-medium text-white',
            BUG_STATUS_STYLE[bug.status].bar,
            main.cutStart ? 'rounded-l-none' : 'ml-1 rounded-l-md',
            main.cutEnd || overrun ? 'rounded-r-none' : 'mr-1 rounded-r-md',
          )}
          style={{ gridRow: 1, gridColumn: `${main.from + 1} / ${main.to + 2}` }}
          title={`${bug.code} · ${BUG_STATUS_LABELS[bug.status]}`}
        >
          {BUG_STATUS_LABELS[bug.status]}
        </div>
      )}

      {bug && overrun && (
        <div
          className={cn(
            'z-10 flex h-6 items-center justify-center truncate bg-red-500 px-1 text-[11px] font-medium text-white',
            overrun.cutStart || main ? 'rounded-l-none' : 'ml-1 rounded-l-md',
            overrun.cutEnd ? 'rounded-r-none' : 'mr-1 rounded-r-md',
          )}
          style={{ gridRow: 1, gridColumn: `${overrun.from + 1} / ${overrun.to + 2}` }}
          title={`Lewat target ${late} hari`}
        >
          +{late}h
        </div>
      )}
    </div>
  );
}

function FlowLegend() {
  const steps = [
    { label: 'Developer Fixing', tone: 'text-blue-600' },
    { label: 'Pending to Test', tone: 'text-amber-600' },
    { label: 'QA Verification', tone: 'text-violet-600' },
    { label: 'Done', tone: 'text-emerald-600' },
  ];

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      {steps.map((step, index) => (
        <span key={step.label} className="flex items-center gap-1.5">
          {index > 0 && <span className="text-slate-300">→</span>}
          <span className={cn('font-medium', step.tone)}>{step.label}</span>
        </span>
      ))}
    </div>
  );
}
