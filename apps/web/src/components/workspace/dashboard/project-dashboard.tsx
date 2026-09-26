'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { SelectControl } from '@/components/ui/field';
import { DonutChart, type DonutDatum } from './donut-chart';
import { ReadinessHero } from './readiness-hero';
import { CATEGORICAL, CATEGORICAL_OVERFLOW } from './palette';
import {
  DEV_SLICES,
  SIT_SLICES,
  TEST_SLICES,
  projectsByRecency,
  scaleToAssignee,
  taskCountsFor,
  type TaskCounts,
} from './mock-data';

/** Where the last opened project is remembered, per browser. */
const LAST_PROJECT_KEY = 'dtrace.workspace.lastProject';

/** The stored id cannot change while this page is open, so nothing to subscribe to. */
const subscribeToNothing = () => () => {};

const ALL_ASSIGNEES = '';

function toDonutData(
  slices: { key: string; label: string; color: string }[],
  counts: Record<string, number>,
): DonutDatum[] {
  return slices.map((slice) => ({ ...slice, value: counts[slice.key] ?? 0 }));
}

/**
 * Assignees in fixed colour order, with everyone past the eighth folded into
 * one bucket. A ninth generated hue would be indistinguishable from one of the
 * first eight, and a bucket that admits it is a bucket beats two people who
 * look like the same person.
 */
function toAssigneeData(counts: TaskCounts): DonutDatum[] {
  const sorted = [...counts.assignees].sort((a, b) => b.total - a.total);
  const named = sorted.slice(0, CATEGORICAL.length);
  const rest = sorted.slice(CATEGORICAL.length);

  const data: DonutDatum[] = named.map((entry, index) => ({
    key: entry.name,
    label: entry.name,
    value: entry.total,
    color: CATEGORICAL[index]!,
  }));

  if (rest.length > 0) {
    data.push({
      key: '__rest',
      label: `Lainnya (${rest.length} orang)`,
      value: rest.reduce((sum, entry) => sum + entry.total, 0),
      color: CATEGORICAL_OVERFLOW,
    });
  }

  return data;
}

const formatPercent = (done: number, total: number) =>
  `${(total === 0 ? 0 : (done / total) * 100).toLocaleString('id-ID', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;

/** Whole days from today to the target, floored at zero. */
function daysRemaining(target: string): number {
  const end = new Date(`${target}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.max(0, Math.ceil((end.getTime() - today.getTime()) / 86_400_000));
}

export function ProjectDashboard() {
  const projects = useMemo(() => projectsByRecency(), []);

  // Read through useSyncExternalStore rather than an effect: it yields the
  // empty server snapshot during SSR and the stored id after hydration, so the
  // right project is selected on the first client render instead of the second.
  const remembered = useSyncExternalStore(
    subscribeToNothing,
    () => window.localStorage.getItem(LAST_PROJECT_KEY) ?? '',
    () => '',
  );

  const [chosen, setChosen] = useState<string | null>(null);

  // The remembered project wins, then the most recently updated one. A stored
  // id for a project that no longer exists falls back rather than showing
  // nothing.
  const projectId =
    chosen ??
    (projects.some((project) => project.id === remembered) ? remembered : null) ??
    projects[0]?.id ??
    '';

  const project = projects.find((entry) => entry.id === projectId) ?? projects[0];

  function selectProject(id: string) {
    if (!id) return;
    setChosen(id);
    try {
      window.localStorage.setItem(LAST_PROJECT_KEY, id);
    } catch {
      // A private window can refuse storage; the dashboard still works, it just
      // forgets. Not worth telling the reader about.
    }
  }

  const [targetDate, setTargetDate] = useState<string | null>(null);
  const [assignee, setAssignee] = useState(ALL_ASSIGNEES);

  const baseCounts = project ? taskCountsFor(project.id) : null;
  const counts = baseCounts && assignee ? scaleToAssignee(baseCounts, assignee) : baseCounts;

  if (!project || !counts) {
    return (
      <Card>
        <CardBody className="text-sm text-slate-500">Belum ada project untuk ditampilkan.</CardBody>
      </Card>
    );
  }

  const target = targetDate ?? project.targetDate;
  const devTotal = Object.values(counts.dev).reduce((sum, value) => sum + value, 0);
  const testTotal = Object.values(counts.test).reduce((sum, value) => sum + value, 0);
  const sitTotal = Object.values(counts.sit).reduce((sum, value) => sum + value, 0);
  const assigneeTotal = counts.assignees.reduce((sum, entry) => sum + entry.total, 0);

  return (
    <div className="space-y-6">
      <header className="rounded-xl border border-sky-100 bg-sky-50/60 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">
                Project {project.name}
              </h1>
              <SelectControl
                aria-label="Pilih project"
                className="h-9 w-64"
                value={project.id}
                onValueChange={selectProject}
                options={projects.map((entry) => ({
                  value: entry.id,
                  label: `${entry.code} · ${entry.name}`,
                }))}
              />
            </div>
            <p className="mt-1 text-sm text-slate-600">{project.description}</p>
          </div>

          <dl className="flex flex-wrap gap-3">
            <div className="rounded-lg border-t-4 border-t-red-400 bg-white px-4 py-2">
              <dt className="text-xs text-slate-500">Tanggal hari ini</dt>
              <dd className="text-lg font-bold text-slate-900">
                {new Date().toLocaleDateString('id-ID', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
              </dd>
            </div>

            <div className="rounded-lg border-t-4 border-t-sky-500 bg-white px-4 py-2">
              <dt className="text-xs text-slate-500">
                <label htmlFor="target-date">Target selesai</label>
              </dt>
              <dd>
                <input
                  id="target-date"
                  type="date"
                  value={target}
                  onChange={(event) => setTargetDate(event.target.value)}
                  className="w-40 bg-transparent text-lg font-bold text-sky-700 outline-none"
                />
              </dd>
            </div>

            <div className="rounded-lg border-t-4 border-t-emerald-500 bg-white px-4 py-2">
              <dt className="text-xs text-slate-500">Sisa waktu</dt>
              <dd className="text-lg font-bold text-emerald-700">{daysRemaining(target)} hari</dd>
            </div>
          </dl>
        </div>
      </header>

      <ReadinessHero counts={counts} />

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-slate-500">Assignee</span>
        <SelectControl
          aria-label="Saring menurut assignee"
          className="h-9 w-64"
          placeholder="Semua assignee"
          value={assignee}
          onValueChange={setAssignee}
          options={(baseCounts?.assignees ?? []).map((entry) => ({
            value: entry.name,
            label: entry.name,
          }))}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Progress Dev" />
          <CardBody>
            <DonutChart
              data={toDonutData(DEV_SLICES, counts.dev)}
              centerValue={formatPercent(counts.dev.closed ?? 0, devTotal)}
              centerCaption="Closed Dev"
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Progress Test" />
          <CardBody>
            <DonutChart
              data={toDonutData(TEST_SLICES, counts.test)}
              centerValue={formatPercent(counts.test.closed ?? 0, testTotal)}
              centerCaption="Closed Test"
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Hasil SIT/UAT" />
          <CardBody>
            <DonutChart
              data={toDonutData(SIT_SLICES, counts.sit)}
              centerValue={formatPercent(counts.sit.complete ?? 0, sitTotal)}
              centerCaption="Complete"
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Task per assignee" />
          <CardBody>
            <DonutChart
              data={toAssigneeData(counts)}
              centerValue={String(assigneeTotal)}
              centerCaption="total task"
              scrollLegend
            />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
