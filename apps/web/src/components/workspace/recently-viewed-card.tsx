'use client';

import { Clock, FileText, X } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { clearViews, useRecentlyViewed } from '@/lib/workspace/recently-viewed';
import { DateTime } from '@/components/ui/date-time';
import { dynamicRoute } from '@/lib/utils/routes';

/**
 * The documents this browser has opened in this project, newest first.
 *
 * Not "recently updated": that was a server fact about the project, and two
 * people looking at the same screen saw the same five names. This answers
 * "where was I", which is a different and more useful question — and it is why
 * the list starts empty and is per browser.
 */
export function RecentlyViewedCard({ projectId }: { projectId: string }) {
  const viewed = useRecentlyViewed(projectId);

  return (
    <Card>
      <CardHeader
        title="Terakhir Dilihat"
        description="Dokumen yang Anda buka di project ini, maksimal 10."
        icon={<Clock className="h-4 w-4" aria-hidden />}
        tinted
        action={
          viewed.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<X className="h-4 w-4" aria-hidden />}
              onClick={() => clearViews(projectId)}
            >
              Bersihkan
            </Button>
          ) : undefined
        }
      />
      <CardBody className="space-y-2">
        {viewed.length === 0 && (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Belum ada. Dokumen yang Anda buka akan muncul di sini.
          </p>
        )}

        {viewed.map((document) => (
          <Link
            key={document.id}
            href={dynamicRoute(`/workspace/dokumen/${document.id}`)}
            className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sky-700 dark:text-sky-400">{document.title}</span>
              <span className="block text-xs text-slate-500">
                <DateTime value={document.viewedAt} />
              </span>
            </span>
          </Link>
        ))}
      </CardBody>
    </Card>
  );
}
