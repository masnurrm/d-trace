import type { ProjectTaskView } from '@dtrace/shared';
import { BLOCKED, DONE, HOLD, NEUTRAL, READY, RUNNING, type Slice } from './palette';

export interface TaskCounts {
  dev: Record<string, number>;
  test: Record<string, number>;
  assignees: { name: string; total: number }[];
}

export const DEV_SLICES: Slice[] = [
  { key: 'unready', label: 'Unready for Dev', color: BLOCKED },
  { key: 'waitingConfirm', label: 'Waiting confirmUser', color: HOLD },
  { key: 'ready', label: 'Ready for Dev', color: READY },
  { key: 'inProgress', label: 'InProgress Dev', color: RUNNING },
  { key: 'closed', label: 'Closed Dev', color: DONE },
];

export const TEST_SLICES: Slice[] = [
  { key: 'reopened', label: 'Re-Opened Dev', color: BLOCKED },
  { key: 'waitingDev', label: 'Waiting Development', color: NEUTRAL },
  { key: 'ready', label: 'Ready for Test', color: READY },
  { key: 'inProgress', label: 'InProgress Test', color: RUNNING },
  { key: 'closed', label: 'Closed Test', color: DONE },
];

export const TEST_RESULT_SLICES: Slice[] = [
  { key: 'pending', label: 'Pending', color: NEUTRAL },
  { key: 'nok', label: 'NOK', color: BLOCKED },
  { key: 'ok', label: 'OK', color: DONE },
];

const DEV_KEYS: Record<ProjectTaskView['devStatus'], string> = {
  UNREADY: 'unready',
  WAITING_CONFIRM_USER: 'waitingConfirm',
  READY: 'ready',
  IN_PROGRESS: 'inProgress',
  CLOSED: 'closed',
};

const TEST_KEYS: Record<ProjectTaskView['testStatus'], string> = {
  REOPENED: 'reopened',
  WAITING_DEVELOPMENT: 'waitingDev',
  READY: 'ready',
  IN_PROGRESS: 'inProgress',
  CLOSED: 'closed',
};

export function taskCountsFor(tasks: ProjectTaskView[], assignee = ''): TaskCounts {
  const visible = assignee
    ? tasks.filter((task) => (task.assigneeName ?? 'Belum ditugaskan') === assignee)
    : tasks;
  const counts: TaskCounts = {
    dev: { unready: 0, waitingConfirm: 0, ready: 0, inProgress: 0, closed: 0 },
    test: { reopened: 0, waitingDev: 0, ready: 0, inProgress: 0, closed: 0 },
    assignees: [],
  };

  const assignees = new Map<string, number>();
  for (const task of visible) {
    counts.dev[DEV_KEYS[task.devStatus]] = (counts.dev[DEV_KEYS[task.devStatus]] ?? 0) + 1;
    counts.test[TEST_KEYS[task.testStatus]] = (counts.test[TEST_KEYS[task.testStatus]] ?? 0) + 1;

    const name = task.assigneeName ?? 'Belum ditugaskan';
    assignees.set(name, (assignees.get(name) ?? 0) + 1);
  }

  counts.assignees = [...assignees].map(([name, total]) => ({ name, total }));
  return counts;
}
