import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import type { DocumentDetail } from '@dtrace/shared';
import { ApiRequestError, apiFetch } from '@/lib/api/server';
import { PrintDocument } from '@/components/document-print/print-document';

export const dynamic = 'force-dynamic';

/**
 * A document as paper, for "Download PDF".
 *
 * Outside the `(app)` group on purpose: the sidebar, header and marquee are
 * the app's, not the document's, and a print page that had to hide them all
 * with CSS would print them the day one of them forgot. The proxy still gates
 * the route, and the API still decides whether this caller may read the
 * document — a restricted one answers 404 here exactly as it does elsewhere.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const document = await loadDocument((await params).id);
  // The browser offers the page title as the PDF's file name, so it is the
  // document's own name — without the app's " · D-Trace" suffix.
  return { title: { absolute: document ? `${document.title} - ${document.projectName}` : 'Dokumen' } };
}

export default async function PrintDocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ auto?: string }>;
}) {
  const [{ id }, { auto }] = await Promise.all([params, searchParams]);
  const document = await loadDocument(id);
  if (!document) notFound();

  return <PrintDocument document={document} autoPrint={auto !== '0'} />;
}

async function loadDocument(id: string): Promise<DocumentDetail | null> {
  try {
    const result = await apiFetch<DocumentDetail>(`/workspace/documents/${id}`);
    return result.data;
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) return null;
    if (error instanceof ApiRequestError && error.isUnauthorized) redirect('/login');
    throw error;
  }
}
