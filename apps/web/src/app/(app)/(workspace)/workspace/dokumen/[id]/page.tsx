import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { DOCUMENT_SCREEN_PATH, type DocumentDetail } from '@dtrace/shared';
import { dynamicRoute } from '@/lib/utils/routes';
import { ApiRequestError, apiFetch } from '@/lib/api/server';
import { SetBreadcrumbs } from '@/components/layout/breadcrumb-context';
import { PageHeader } from '@/components/ui/page-header';
import { DocumentEditor } from '@/components/workspace/document-editor';
import { ReleaseRequestForm } from '@/components/workspace/release-request-form';
import { RecordDocumentView } from '@/components/workspace/record-document-view';

export const metadata: Metadata = { title: 'Dokumen' };
export const dynamic = 'force-dynamic';

/**
 * The document editor. The API sends the template's sections together with
 * this document's answers, so the page never has to fetch the shape and the
 * contents separately and reconcile two arrival times.
 */
export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const document = await loadDocument(id);
  if (!document) notFound();

  // A row that stands for one of the project's screens has nothing to edit
  // here. The document table links straight to the screen, but the sidebar
  // tree and any bookmark still address it by document id, so the redirect
  // lives here — the one place every route in passes through.
  if (document.screen) {
    redirect(
      dynamicRoute(
        `/workspace/project/${document.projectId}/${DOCUMENT_SCREEN_PATH[document.screen]}`,
      ),
    );
  }

  // A few documents are forms in their own right rather than a template poured
  // into the generic editor. They are told apart by the template they were
  // produced from, not by their title — a title is renameable, and renaming a
  // document should not change which screen it opens.
  const ownScreen = OWN_SCREEN[document.template?.code ?? ''];

  return (
    <div className="space-y-6">
      {/* The header cannot tell which project a document id belongs to, and the
          project is where a reader goes back to — so the trail names it. */}
      <SetBreadcrumbs
        trail={[
          { label: 'Project', href: '/workspace/project' },
          { label: document.nodeName },
          {
            label: document.projectName,
            href: dynamicRoute(`/workspace/project/${document.projectId}`),
          },
          { label: document.title },
        ]}
      />
      <RecordDocumentView
        projectId={document.projectId}
        documentId={document.id}
        title={document.title}
      />

      {ownScreen ? (
        ownScreen(document)
      ) : (
        <>
          <PageHeader
            title={document.title}
            description={`${document.breadcrumb} — isi dokumen dan riwayat versinya.`}
          />
          <DocumentEditor document={document} />
        </>
      )}
    </div>
  );
}

/**
 * Template code → the screen that owns it.
 *
 * A map rather than a chain of `if`s so adding the next such form is one line,
 * and so a template with no entry falls through to the generic editor by
 * default instead of by omission.
 */
const OWN_SCREEN: Record<string, ((document: DocumentDetail) => ReactNode) | undefined> = {
  RRF: (document) => <ReleaseRequestForm document={document} />,
  RRF_SEC: (document) => <ReleaseRequestForm document={document} variant="SECURITY" />,
};

async function loadDocument(id: string): Promise<DocumentDetail | null> {
  try {
    const result = await apiFetch<DocumentDetail>(`/workspace/documents/${id}`);
    return result.data;
  } catch (error) {
    // A document the caller is restricted from answers 404 by design, so an
    // unreachable one and a missing one land on the same page.
    if (error instanceof ApiRequestError && error.status === 404) return null;
    throw error;
  }
}
