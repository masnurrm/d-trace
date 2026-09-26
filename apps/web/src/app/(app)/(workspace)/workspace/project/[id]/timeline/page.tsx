import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ProjectTimelineView } from '@dtrace/shared';
import { ApiRequestError, apiFetch } from '@/lib/api/server';
import { dynamicRoute } from '@/lib/utils/routes';
import { SetBreadcrumbs } from '@/components/layout/breadcrumb-context';
import { PageHeader } from '@/components/ui/page-header';
import { TimelineView } from '@/components/workspace/timeline/timeline-view';

export const metadata: Metadata = { title: 'Timeline' };
export const dynamic = 'force-dynamic';

/**
 * The project schedule. Like the estimate, it is created on first open: the
 * task list it draws is the mandays plan's, so opening this page seeds the
 * standard breakdown rather than showing an empty chart.
 */
export default async function ProjectTimelinePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const timeline = await loadTimeline(id);
  if (!timeline) notFound();

  return (
    <div className="space-y-6">
      <SetBreadcrumbs
        trail={[
          { label: 'Project', href: '/workspace/project' },
          { label: timeline.node.name },
          { label: timeline.projectName, href: dynamicRoute(`/workspace/project/${id}`) },
          { label: 'Timeline' },
        ]}
      />
      <PageHeader
        title="Timeline"
        description={`Jadwal pengerjaan per tahapan — ${timeline.projectName}.`}
      />
      <TimelineView timeline={timeline} />
    </div>
  );
}

async function loadTimeline(projectId: string): Promise<ProjectTimelineView | null> {
  try {
    const result = await apiFetch<ProjectTimelineView>(
      `/workspace/projects/${projectId}/timeline`,
    );
    return result.data;
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) return null;
    throw error;
  }
}
