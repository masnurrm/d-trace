import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { MandayPlanView } from '@dtrace/shared';
import { ApiRequestError, apiFetch } from '@/lib/api/server';
import { dynamicRoute } from '@/lib/utils/routes';
import { SetBreadcrumbs } from '@/components/layout/breadcrumb-context';
import { PageHeader } from '@/components/ui/page-header';
import { MandayEditor } from '@/components/workspace/manday-editor';

export const metadata: Metadata = { title: 'Create Mandays' };
export const dynamic = 'force-dynamic';

/**
 * Create Mandays. The plan is created on first open rather than by a separate
 * step — an estimate nobody has filled in is indistinguishable from one that
 * does not exist, so there is nothing to ask about.
 */
export default async function MandaysPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const plan = await loadPlan(id);
  if (!plan) notFound();

  return (
    <div className="space-y-6">
      <SetBreadcrumbs
        trail={[
          { label: 'Project', href: '/workspace/project' },
          { label: plan.node.name },
          { label: plan.projectName, href: dynamicRoute(`/workspace/project/${id}`) },
          { label: 'Create Mandays' },
        ]}
      />
      <PageHeader
        title="Create Mandays"
        description={`Estimasi mandays berdasarkan tahapan project — ${plan.projectName}.`}
      />
      <MandayEditor plan={plan} />
    </div>
  );
}

async function loadPlan(projectId: string): Promise<MandayPlanView | null> {
  try {
    const result = await apiFetch<MandayPlanView>(`/workspace/projects/${projectId}/mandays`);
    return result.data;
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) return null;
    throw error;
  }
}
