import type { Metadata } from 'next';
import { ROLES, hasAtLeastRole, type DocumentTemplateSummary, type Role } from '@dtrace/shared';
import { apiFetch, getSessionUser } from '@/lib/api/server';
import { PageHeader } from '@/components/ui/page-header';
import { TemplatesPanel } from '@/components/document-templates/templates-panel';

export const metadata: Metadata = { title: 'Dokumen Template' };
export const dynamic = 'force-dynamic';

/**
 * The master template list. Rendered on the server so the table arrives with
 * the HTML; the panel below only handles the dialogs that mutate it.
 */
export default async function DocumentTemplatesPage() {
  const [sessionUser, result] = await Promise.all([
    getSessionUser(),
    apiFetch<DocumentTemplateSummary[]>('/document-templates?includeInactive=true&limit=100'),
  ]);

  const canEdit = hasAtLeastRole((sessionUser?.role ?? ROLES.VIEWER) as Role, ROLES.ADMIN);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dokumen Template"
        description="Master template dokumen: susunan section, sumber data, dan bagian mana yang diisi user."
      />

      <TemplatesPanel templates={result.data} canEdit={canEdit} />
    </div>
  );
}
