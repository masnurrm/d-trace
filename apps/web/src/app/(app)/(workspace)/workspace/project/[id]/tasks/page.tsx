import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ProjectTaskView } from '@dtrace/shared';
import { ApiRequestError, apiFetch } from '@/lib/api/server';
import { loadProject } from '@/lib/api/project';
import { SetBreadcrumbs } from '@/components/layout/breadcrumb-context';
import { PageHeader } from '@/components/ui/page-header';
import { TaskActivity } from '@/components/workspace/tasks/task-activity';
import { dynamicRoute } from '@/lib/utils/routes';

export const metadata: Metadata = { title: 'Task Activity' };
export const dynamic = 'force-dynamic';

/**
 * Task Activity: the module task list for one project.
 *
 * Both requests are made here so the table arrives complete — the task rows
 * name their assignee, and the dialog needs the team to offer as options.
 */
export default async function ProjectTasksPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [project, tasks] = await Promise.all([loadProject(id), loadTasks(id)]);
  if (!project || !tasks) notFound();

  return (
    <div className="space-y-6">
      <SetBreadcrumbs
        trail={[
          { label: 'Project', href: '/workspace/project' },
          { label: project.node.name },
          { label: project.name, href: dynamicRoute(`/workspace/project/${id}`) },
          { label: 'Task Activity' },
        ]}
      />

      <PageHeader
        title="Task Activity"
        description={`Daftar task per modul — ${project.name}.`}
      />

      <TaskActivity
        projectId={id}
        projectName={project.name}
        tasks={tasks}
        members={project.members.map((member) => ({ userId: member.userId, name: member.name }))}
        canEdit={project.capabilities.createDocument}
      />
    </div>
  );
}

async function loadTasks(id: string): Promise<ProjectTaskView[] | null> {
  try {
    const result = await apiFetch<ProjectTaskView[]>(`/workspace/projects/${id}/tasks`);
    return result.data;
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) return null;
    throw error;
  }
}
