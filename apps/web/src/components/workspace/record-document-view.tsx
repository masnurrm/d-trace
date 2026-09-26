'use client';

import { useEffect } from 'react';
import { recordView } from '@/lib/workspace/recently-viewed';

/**
 * Records that this document was opened. Renders nothing.
 *
 * In an effect rather than during render because writing to storage is a side
 * effect, and React may render a component twice without the person having
 * opened anything twice. The title is recorded with the id so the card can
 * list it without a second request — a stale title is a smaller problem than a
 * list that cannot render until the network answers.
 */
export function RecordDocumentView({
  projectId,
  documentId,
  title,
}: {
  projectId: string;
  documentId: string;
  title: string;
}) {
  useEffect(() => {
    recordView(projectId, { id: documentId, title });
  }, [projectId, documentId, title]);

  return null;
}
