'use client';

import { FileText, Star } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  DOCUMENT_STATUS_LABELS,
  PROJECT_STAGE_LABELS,
  type WorkspaceDocumentSummary,
} from '@dtrace/shared';
import { clientFetch } from '@/lib/api/client';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { DateTime } from '@/components/ui/date-time';
import { cn } from '@/lib/utils/cn';
import { dynamicRoute } from '@/lib/utils/routes';

const STATUS_TONES = {
  DRAFT: 'neutral',
  ON_PROGRESS: 'info',
  REVIEW: 'warning',
  FINAL: 'success',
} as const;

export interface DocumentListProps {
  documents: WorkspaceDocumentSummary[];
  emptyMessage: string;
  /** Show the star control. Off where starring would be noise. */
  showFavorite?: boolean;
}

/**
 * A list of documents with their location.
 *
 * The line under each title is what makes the list usable: the same document
 * title occurs in many projects, so "BPM" on its own identifies nothing. The
 * breadcrumb the API builds is printed verbatim rather than reassembled here,
 * so the recent list and the sidebar agree on where something lives.
 */
export function DocumentList({ documents, emptyMessage, showFavorite = true }: DocumentListProps) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [starred, setStarred] = useState<Record<string, boolean>>({});

  const isFavorite = (document: WorkspaceDocumentSummary) =>
    starred[document.id] ?? document.isFavorite;

  async function toggleFavorite(document: WorkspaceDocumentSummary) {
    const next = !isFavorite(document);
    // Optimistic: starring is a personal shortcut, and waiting a round trip to
    // colour a star makes the list feel broken.
    setStarred((current) => ({ ...current, [document.id]: next }));
    setPending(document.id);

    try {
      await clientFetch<void>(`/workspace/documents/${document.id}/favorite`, {
        method: 'POST',
        body: { favorite: next },
      });
      router.refresh();
    } catch {
      setStarred((current) => ({ ...current, [document.id]: !next }));
    } finally {
      setPending(null);
    }
  }

  if (documents.length === 0) {
    return (
      <Card className="px-5 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
        {emptyMessage}
      </Card>
    );
  }

  return (
    <Card className="divide-y divide-slate-100 dark:divide-slate-800">
      {documents.map((document) => (
        <div key={document.id} className="flex items-start gap-3 px-5 py-4">
          <FileText className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />

          <div className="min-w-0 flex-1">
            <Link
              href={dynamicRoute(`/workspace/dokumen/${document.id}`)}
              className="font-medium text-slate-900 hover:underline dark:text-slate-100"
            >
              {document.title}
            </Link>
            <p className="truncate text-xs text-amber-700 dark:text-amber-500">
              {document.breadcrumb}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {PROJECT_STAGE_LABELS[document.stage]} · Diperbarui{' '}
              <DateTime value={document.updatedAt} />
              {document.ownerName && ` · ${document.ownerName}`}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Badge tone={STATUS_TONES[document.status]}>
              {DOCUMENT_STATUS_LABELS[document.status]}
            </Badge>

            {showFavorite && (
              <button
                type="button"
                onClick={() => toggleFavorite(document)}
                disabled={pending === document.id}
                aria-pressed={isFavorite(document)}
                aria-label={
                  isFavorite(document)
                    ? `Hapus ${document.title} dari favorit`
                    : `Tandai ${document.title} sebagai favorit`
                }
                className="rounded p-1 text-slate-400 transition-colors hover:text-amber-500 disabled:opacity-50"
              >
                <Star
                  className={cn(
                    'h-4 w-4',
                    isFavorite(document) && 'fill-amber-400 text-amber-400',
                  )}
                  aria-hidden
                />
              </button>
            )}
          </div>
        </div>
      ))}
    </Card>
  );
}
