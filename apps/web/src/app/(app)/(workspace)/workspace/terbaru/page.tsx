import type { Metadata } from 'next';
import type { WorkspaceDocumentSummary } from '@dtrace/shared';
import { apiFetch } from '@/lib/api/server';
import { PageHeader } from '@/components/ui/page-header';
import { DocumentList } from '@/components/workspace/document-list';

export const metadata: Metadata = { title: 'Terbaru' };
export const dynamic = 'force-dynamic';

/** Documents the caller may read, most recently updated first. */
export default async function RecentPage() {
  const result = await apiFetch<WorkspaceDocumentSummary[]>(
    '/workspace/documents?limit=50&sortBy=updatedAt&sortOrder=desc',
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Terbaru" description="Dokumen yang paling baru diperbarui." />
      <DocumentList
        documents={result.data}
        emptyMessage="Belum ada dokumen di node yang Anda akses."
      />
    </div>
  );
}
