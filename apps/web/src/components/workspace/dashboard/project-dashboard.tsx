'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState, useSyncExternalStore } from 'react';
import {
  PROJECT_STATUS_LABELS,
  summarizeTestScript,
  type ProjectTaskView,
  type ProjectView,
  type TestScriptView,
  type WorkspaceTree,
} from '@dtrace/shared';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { SelectControl } from '@/components/ui/field';
import { clientFetch } from '@/lib/api/client';
import { DonutChart, type DonutDatum } from './donut-chart';
import { ReadinessHero } from './readiness-hero';
import { CATEGORICAL, CATEGORICAL_OVERFLOW } from './palette';
import {
  DEV_SLICES,
  TEST_RESULT_SLICES,
  TEST_SLICES,
  taskCountsFor,
  type TaskCounts,
} from './dashboard-data';

const LAST_PROJECT_KEY = 'dtrace.workspace.lastProject';
const subscribeToNothing = () => () => {};
const ALL_ASSIGNEES = '';

function toDonutData(
  slices: { key: string; label: string; color: string }[],
  counts: Record<string, number>,
): DonutDatum[] {
  return slices.map((slice) => ({ ...slice, value: counts[slice.key] ?? 0 }));
}

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

function daysRemaining(target: string | null): number | null {
  if (!target) return null;
  const end = new Date(`${target}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.max(0, Math.ceil((end.getTime() - today.getTime()) / 86_400_000));
}

export function ProjectDashboard() {
  const treeQuery = useQuery({
    queryKey: ['workspace', 'tree'],
    queryFn: async () => (await clientFetch<WorkspaceTree>('/workspace/tree')).data,
  });
  const projects = useMemo(
    () =>
      (treeQuery.data?.nodes ?? [])
        .flatMap((node) => node.projects)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [treeQuery.data],
  );
  const remembered = useSyncExternalStore(
    subscribeToNothing,
    () => window.localStorage.getItem(LAST_PROJECT_KEY) ?? '',
    () => '',
  );
  const [chosen, setChosen] = useState<string | null>(null);
  const [assignee, setAssignee] = useState(ALL_ASSIGNEES);
  const projectId =
    chosen ??
    (projects.some((entry) => entry.id === remembered) ? remembered : null) ??
    projects[0]?.id ??
    '';
  const project = projects.find((entry) => entry.id === projectId) ?? projects[0];

  const detailQuery = useQuery({
    queryKey: ['workspace', 'projects', project?.id],
    queryFn: async () =>
      (await clientFetch<ProjectView>(`/workspace/projects/${project!.id}`)).data,
    enabled: Boolean(project),
  });
  const tasksQuery = useQuery({
    queryKey: ['workspace', 'projects', project?.id, 'tasks'],
    queryFn: async () =>
      (await clientFetch<ProjectTaskView[]>(`/workspace/projects/${project!.id}/tasks`)).data,
    enabled: Boolean(project),
  });
  const sitQuery = useQuery({
    queryKey: ['workspace', 'projects', project?.id, 'test-scripts', 'SIT'],
    queryFn: async () =>
      (await clientFetch<TestScriptView>(`/workspace/projects/${project!.id}/test-scripts/sit`))
        .data,
    enabled: Boolean(project),
  });
  const uatQuery = useQuery({
    queryKey: ['workspace', 'projects', project?.id, 'test-scripts', 'UAT'],
    queryFn: async () =>
      (await clientFetch<TestScriptView>(`/workspace/projects/${project!.id}/test-scripts/uat`))
        .data,
    enabled: Boolean(project),
  });

  function selectProject(id: string) {
    if (!id) return;
    setChosen(id);
    setAssignee(ALL_ASSIGNEES);
    try {
      window.localStorage.setItem(LAST_PROJECT_KEY, id);
    } catch {
      // The dashboard still works when browser storage is unavailable.
    }
  }

  if (treeQuery.isPending) {
    return (
      <Card>
        <CardBody className="text-sm text-slate-500">Memuat data project...</CardBody>
      </Card>
    );
  }
  if (treeQuery.error) {
    return (
      <Card>
        <CardBody className="text-sm text-red-600">Data dashboard gagal dimuat.</CardBody>
      </Card>
    );
  }
  if (!project) {
    return (
      <Card>
        <CardBody className="text-sm text-slate-500">Belum ada project untuk ditampilkan.</CardBody>
      </Card>
    );
  }

  const tasks = tasksQuery.data ?? [];
  const counts = taskCountsFor(tasks);
  const assigneeCounts = taskCountsFor(tasks, assignee);
  const detail = detailQuery.data;
  const sit = summarizeTestScript(sitQuery.data?.modules ?? []);
  const uat = summarizeTestScript(uatQuery.data?.modules ?? []);
  const target = detail?.goLiveAt?.slice(0, 10) ?? null;
  const remaining = daysRemaining(target);
  const devTotal = Object.values(counts.dev).reduce((sum, value) => sum + value, 0);
  const testTotal = Object.values(counts.test).reduce((sum, value) => sum + value, 0);
  const assigneeTotal = assigneeCounts.assignees.reduce((sum, entry) => sum + entry.total, 0);

  return (
    <div className="space-y-6">
      <header className="rounded-xl border border-sky-100 bg-sky-50/60 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-extrabold text-slate-900">Project {project.name}</h1>
              <SelectControl
                aria-label="Pilih project"
                className="h-9 w-80"
                value={project.id}
                onValueChange={selectProject}
                options={projects.map((entry) => ({
                  value: entry.id,
                  label: `${entry.code} · ${entry.name} (${PROJECT_STATUS_LABELS[entry.status]})`,
                }))}
              />
            </div>
            <p className="mt-1 text-sm text-slate-600">
              {detail?.description || PROJECT_STATUS_LABELS[project.status]}
            </p>
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
              <dt className="text-xs text-slate-500">Target selesai</dt>
              <dd className="text-lg font-bold text-sky-700">
                {target
                  ? new Date(`${target}T00:00:00`).toLocaleDateString('id-ID', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                    })
                  : 'Belum ditentukan'}
              </dd>
            </div>
            <div className="rounded-lg border-t-4 border-t-emerald-500 bg-white px-4 py-2">
              <dt className="text-xs text-slate-500">Sisa waktu</dt>
              <dd className="text-lg font-bold text-emerald-700">
                {project.status === 'DONE'
                  ? 'Selesai'
                  : remaining === null
                    ? '–'
                    : `${remaining} hari`}
              </dd>
            </div>
          </dl>
        </div>
      </header>

      {tasksQuery.isPending ? (
        <Card>
          <CardBody className="text-sm text-slate-500">Memuat progres task...</CardBody>
        </Card>
      ) : tasksQuery.error ? (
        <Card>
          <CardBody className="text-sm text-red-600">Progres task gagal dimuat.</CardBody>
        </Card>
      ) : (
        <>
          <ReadinessHero counts={counts} />
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-2">
              <h2 className="text-lg font-bold text-slate-900">Project Activity Plan</h2>
              <div className="flex items-center gap-3">
                <span className="text-sm text-slate-500">Assignee Development</span>
                <SelectControl
                  aria-label="Saring task development menurut assignee"
                  className="h-9 w-64"
                  placeholder="Semua assignee"
                  value={assignee}
                  onValueChange={setAssignee}
                  options={counts.assignees.map((entry) => ({
                    value: entry.name,
                    label: entry.name,
                  }))}
                />
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-3">
              <Card>
                <CardHeader title="Task Development per Assignee" />
                <CardBody>
                  <DonutChart
                    data={toAssigneeData(assigneeCounts)}
                    centerValue={String(assigneeTotal)}
                    centerCaption="task development"
                    scrollLegend
                  />
                </CardBody>
              </Card>
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
            </div>
          </section>

          <section className="space-y-3">
            <div className="border-b border-slate-200 pb-2">
              <h2 className="text-lg font-bold text-slate-900">Activity Testing</h2>
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              <Card>
                <CardHeader title="Hasil SIT" />
                <CardBody>
                  <DonutChart
                    data={toDonutData(TEST_RESULT_SLICES, {
                      pending: sit.pending,
                      nok: sit.nok,
                      ok: sit.ok,
                    })}
                    centerValue={formatPercent(sit.ok, sit.total)}
                    centerCaption="OK"
                  />
                </CardBody>
              </Card>
              <Card>
                <CardHeader title="Hasil UAT" />
                <CardBody>
                  <DonutChart
                    data={toDonutData(TEST_RESULT_SLICES, {
                      pending: uat.pending,
                      nok: uat.nok,
                      ok: uat.ok,
                    })}
                    centerValue={formatPercent(uat.ok, uat.total)}
                    centerCaption="OK"
                  />
                </CardBody>
              </Card>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
