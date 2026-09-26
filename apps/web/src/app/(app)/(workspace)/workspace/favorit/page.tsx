import type { Metadata } from 'next';
import type { WorkspaceDocumentSummary } from '@dtrace/shared';
import { apiFetch } from '@/lib/api/server';
import { PageHeader } from '@/components/ui/page-header';
import { DocumentList } from '@/components/workspace/document-list';

export const metadata: Metadata = { title: 'Favorit' };
export const dynamic = 'force-dynamic';

/** The caller's own starred documents. Favourites are personal, never shared. */
export default async function FavoritesPage() {
  const result = await apiFetch<WorkspaceDocumentSummary[]>(
    '/workspace/documents?favorite=true&limit=50',
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Favorit"
        description="Dokumen yang Anda tandai. Tanda ini hanya terlihat oleh Anda."
      />
      <DocumentList
        documents={result.data}
        emptyMessage="Belum ada dokumen favorit. Tandai dokumen dengan ikon bintang."
      />
    </div>
  );
}
