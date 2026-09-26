import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ImplementationPlanView } from '@dtrace/shared';
import { ApiRequestError, apiFetch } from '@/lib/api/server';
import { loadProject } from '@/lib/api/project';
import { SetBreadcrumbs } from '@/components/layout/breadcrumb-context';
import { PageHeader } from '@/components/ui/page-header';
import { ImplementationPlanEditor } from '@/components/workspace/implementation-plan/implementation-plan-editor';
import { dynamicRoute } from '@/lib/utils/routes';

export const metadata: Metadata = { title: 'Implementation Plan' };
export const dynamic = 'force-dynamic';

/**
 * The implementation plan of one project — the screen the project's
 * "Implementation Document" row opens.
 */
export default async function ImplementationPlanPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [project, plan] = await Promise.all([loadProject(id), loadPlan(id)]);
  if (!project || !plan) notFound();

  return (
    <div className="space-y-6">
      <SetBreadcrumbs
        trail={[
          { label: 'Project', href: '/workspace/project' },
          { label: project.node.name },
          { label: project.name, href: dynamicRoute(`/workspace/project/${id}`) },
          { label: 'Implementation Plan' },
        ]}
      />

      <PageHeader
        title="Implementation Plan"
        description={`Urutan aktivitas implementasi ${project.name}: estimasi durasi menyusun jadwal secara berurutan, aktualnya dicatat saat dijalankan.`}
      />

      <ImplementationPlanEditor
        projectId={id}
        projectName={project.name}
        plan={plan}
        canEdit={project.capabilities.createDocument}
      />
    </div>
  );
}

async function loadPlan(id: string): Promise<ImplementationPlanView | null> {
  try {
    const result = await apiFetch<ImplementationPlanView>(
      `/workspace/projects/${id}/implementation-plan`,
    );
    return result.data;
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) return null;
    throw error;
  }
}
