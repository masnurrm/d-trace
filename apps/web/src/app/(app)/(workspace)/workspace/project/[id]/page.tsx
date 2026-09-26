import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { DocumentTemplateSummary, ProjectView } from '@dtrace/shared';
import { ApiRequestError, apiFetch } from '@/lib/api/server';
import { SetBreadcrumbs } from '@/components/layout/breadcrumb-context';
import { PageHeader } from '@/components/ui/page-header';
import { DeleteProjectButton } from '@/components/workspace/delete-project-button';
import { ProjectSpace } from '@/components/workspace/project-space';

export const metadata: Metadata = { title: 'Project Space' };
export const dynamic = 'force-dynamic';

/**
 * Project Space. The API decides what this caller may do here and sends it
 * with the project, so the page never re-derives a permission the server
 * already resolved from the node grant.
 */
export default async function ProjectSpacePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [project, templates] = await Promise.all([
    loadProject(id),
    apiFetch<DocumentTemplateSummary[]>('/document-templates?limit=100').catch(() => null),
  ]);

  if (!project) notFound();

  return (
    <div className="space-y-6">
      {/*
        The node path can be several levels deep; the crumb keeps the nearest
        one, which is the level a reader actually navigates by. The full path
        stays in the description under the title.
      */}
      <SetBreadcrumbs
        trail={[
          { label: 'Project', href: '/workspace/project' },
          { label: project.node.name },
          { label: project.name },
        ]}
      />
      <PageHeader
        title={project.name}
        titleAction={
          project.canDelete ? (
            <DeleteProjectButton
              projectId={project.id}
              name={project.name}
              code={project.code}
              documentCount={project.documents.length}
            />
          ) : undefined
        }
        description={`${[...project.node.path, project.code].join(' / ')} — ruang kolaborasi dokumen dan status project.`}
      />
      <ProjectSpace project={project} templates={templates?.data ?? []} />
    </div>
  );
}

async function loadProject(id: string): Promise<ProjectView | null> {
  try {
    const result = await apiFetch<ProjectView>(`/workspace/projects/${id}`);
    return result.data;
  } catch (error) {
    // A project the caller has no grant on answers 404 by design, so an
    // unreachable project and a missing one land on the same page.
    if (error instanceof ApiRequestError && error.status === 404) return null;
    throw error;
  }
}
