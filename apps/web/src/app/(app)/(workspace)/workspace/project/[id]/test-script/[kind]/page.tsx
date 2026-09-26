import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  TEST_SCRIPT_KIND_LABELS,
  TEST_SCRIPT_KIND_SLUG,
  testScriptKindFromSlug,
  type TestScriptKind,
  type TestScriptView,
} from '@dtrace/shared';
import { ApiRequestError, apiFetch } from '@/lib/api/server';
import { loadProject } from '@/lib/api/project';
import { SetBreadcrumbs } from '@/components/layout/breadcrumb-context';
import { PageHeader } from '@/components/ui/page-header';
import { TestScriptEditor } from '@/components/workspace/test-script/test-script-editor';
import { dynamicRoute } from '@/lib/utils/routes';

export const metadata: Metadata = { title: 'Test Script' };
export const dynamic = 'force-dynamic';

/**
 * The SIT or UAT script of one project — `/test-script/sit` or `/test-script/uat`.
 *
 * One route for both because they are one form: the same columns, the same
 * rules, a different stage of testing. Anything else in the slot is a 404.
 */
export default async function TestScriptPage({
  params,
}: {
  params: Promise<{ id: string; kind: string }>;
}) {
  const { id, kind: slug } = await params;
  const kind = testScriptKindFromSlug(slug);
  if (!kind) notFound();

  const [project, script] = await Promise.all([loadProject(id), loadScript(id, kind)]);
  if (!project || !script) notFound();

  const label = TEST_SCRIPT_KIND_LABELS[kind];

  return (
    <div className="space-y-6">
      <SetBreadcrumbs
        trail={[
          { label: 'Project', href: '/workspace/project' },
          { label: project.node.name },
          { label: project.name, href: dynamicRoute(`/workspace/project/${id}`) },
          { label: `${kind} Script` },
        ]}
      />

      <PageHeader
        title={`Test Script ${kind}`}
        description={`${label} — ${project.name}.`}
      />

      <TestScriptEditor
        // Keyed by kind so moving between SIT and UAT starts from the loaded
        // script instead of carrying the other one's unsaved state across.
        key={kind}
        projectId={id}
        projectName={project.name}
        script={script}
        canEdit={project.capabilities.createDocument}
      />
    </div>
  );
}

async function loadScript(id: string, kind: TestScriptKind): Promise<TestScriptView | null> {
  try {
    const result = await apiFetch<TestScriptView>(
      `/workspace/projects/${id}/test-scripts/${TEST_SCRIPT_KIND_SLUG[kind]}`,
    );
    return result.data;
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) return null;
    throw error;
  }
}
