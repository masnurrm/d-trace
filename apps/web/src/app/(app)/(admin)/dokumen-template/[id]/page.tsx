import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ROLES, hasAtLeastRole, type DocumentTemplateView, type Role } from '@dtrace/shared';
import { ApiRequestError, apiFetch, getSessionUser } from '@/lib/api/server';
import { SetBreadcrumbs } from '@/components/layout/breadcrumb-context';
import { TemplateBuilder } from '@/components/document-templates/template-builder';

export const metadata: Metadata = { title: 'Master Template Config' };
export const dynamic = 'force-dynamic';

/**
 * The builder. The whole template is fetched here and handed to the client as
 * one draft — the editor needs every section at once to render the document,
 * and fetching them per section would make the preview arrive in pieces.
 *
 * No `PageHeader`: this is a three-pane editor, and a title band above it just
 * pushed the panes down without telling anyone anything new. The breadcrumb
 * names the template, and the Structure pane holds its name, code and version
 * as editable fields — so the identity is on screen twice already.
 */
export default async function DocumentTemplateBuilderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [sessionUser, template] = await Promise.all([
    getSessionUser(),
    loadTemplate(id),
  ]);

  if (!template) notFound();

  const canEdit = hasAtLeastRole((sessionUser?.role ?? ROLES.VIEWER) as Role, ROLES.ADMIN);

  return (
    <>
      <SetBreadcrumbs
        trail={[
          { label: 'Konfigurasi' },
          { label: 'Dokumen Template', href: '/dokumen-template' },
          { label: `${template.name} v${template.version}` },
        ]}
      />

      <TemplateBuilder template={template} canEdit={canEdit} />
    </>
  );
}

async function loadTemplate(id: string): Promise<DocumentTemplateView | null> {
  try {
    const result = await apiFetch<DocumentTemplateView>(`/document-templates/${id}`);
    return result.data;
  } catch (error) {
    // A bad id in the URL is a 404 page, not an error screen. Anything else —
    // an unreachable API, a refused role — still propagates to the layout.
    if (error instanceof ApiRequestError && error.status === 404) return null;
    throw error;
  }
}
