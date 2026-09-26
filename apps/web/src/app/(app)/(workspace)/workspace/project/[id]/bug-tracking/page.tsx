import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { BUG_ENVIRONMENTS, type BugEnvironment, type ProjectBugsView } from '@dtrace/shared';
import { ApiRequestError, apiFetch } from '@/lib/api/server';
import { loadProject } from '@/lib/api/project';
import { dynamicRoute } from '@/lib/utils/routes';
import { SetBreadcrumbs } from '@/components/layout/breadcrumb-context';
import { Alert } from '@/components/ui/alert';
import { PageHeader } from '@/components/ui/page-header';
import { BugTrackingBoard } from '@/components/workspace/bug-tracking/bug-tracking-board';
import { ENV_ALL } from '@/components/workspace/bug-tracking/bug-style';

export const metadata: Metadata = { title: 'Bug & Issue' };
export const dynamic = 'force-dynamic';

/**
 * The Bug & Issue list of one project — the screen the "Bug & Issue List"
 * row opens.
 *
 * Both requests are made here so the board arrives complete: the bug rows,
 * the environment the project has reached (which picks the default filter),
 * and the team the dialog offers as developer and QA.
 *
 * `?env=` overrides the default, so a link to "the UAT bugs" keeps saying UAT
 * after the project has gone live. Anything unrecognised is ignored rather
 * than refused — a stale bookmark should still open the list.
 */
export default async function ProjectBugTrackingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ env?: string | string[] }>;
}) {
  const { id } = await params;
  const { env } = await searchParams;

  const [project, bugs] = await Promise.all([loadProject(id), loadBugs(id)]);
  if (!project || !bugs) notFound();

  const breadcrumbs = (
    <SetBreadcrumbs
      trail={[
        { label: 'Project', href: '/workspace/project' },
        { label: project.node.name },
        { label: project.name, href: dynamicRoute(`/workspace/project/${id}`) },
        { label: 'Bug & Issue' },
      ]}
    />
  );

  if (bugs === FORBIDDEN) {
    return (
      <div className="space-y-6">
        {breadcrumbs}
        <PageHeader title="Bug & Issue" />
        <Alert tone="warning" title="Tidak ada akses">
          Peran Anda di node ini tidak mencakup izin melihat issue. Minta admin node mengaktifkannya
          di Role &amp; Akses.
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {breadcrumbs}

      <BugTrackingBoard
        projectId={id}
        projectName={project.name}
        data={bugs}
        requestedEnvironment={parseEnvironment(env)}
        members={project.members.map((member) => ({ userId: member.userId, name: member.name }))}
        can={{
          create: project.capabilities.createIssue,
          update: project.capabilities.updateIssue,
          delete: project.capabilities.deleteIssue,
        }}
      />
    </div>
  );
}

function parseEnvironment(value: string | string[] | undefined): BugEnvironment | typeof ENV_ALL | null {
  const raw = (Array.isArray(value) ? value[0] : value)?.toUpperCase();
  if (raw === ENV_ALL) return ENV_ALL;
  return BUG_ENVIRONMENTS.find((environment) => environment === raw) ?? null;
}

const FORBIDDEN = 'forbidden';

/**
 * The list, or why there is none. A 403 is somebody who can see the project
 * but whose grant has `issue.view` switched off — they reached this page from
 * the project's own document list, so it says what is missing rather than
 * pretending the page does not exist.
 */
async function loadBugs(id: string): Promise<ProjectBugsView | typeof FORBIDDEN | null> {
  try {
    const result = await apiFetch<ProjectBugsView>(`/workspace/projects/${id}/bugs`);
    return result.data;
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) return null;
    if (error instanceof ApiRequestError && error.status === 403) return FORBIDDEN;
    throw error;
  }
}
