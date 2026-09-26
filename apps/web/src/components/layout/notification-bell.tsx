'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import type { NotificationFeed, NotificationView } from '@dtrace/shared';
import { clientFetch } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { DateTime } from '@/components/ui/date-time';
import { cn } from '@/lib/utils/cn';
import { dynamicRoute } from '@/lib/utils/routes';
import { useNotificationSocket } from '@/lib/notifications/use-notification-socket';

/**
 * How often the bell falls back to asking, when the socket is down.
 *
 * Slow on purpose: this is the safety net for a dropped connection, not the
 * mechanism. While the socket is up there is no polling at all.
 */
const FALLBACK_POLL_MS = 120_000;

/**
 * The notification bell.
 *
 * Pushed over a socket: the server sends the whole feed the moment it changes,
 * so the count is right immediately rather than up to a minute late — and a
 * second tab that marks something read updates this one too.
 *
 * The HTTP fetch stays as the first load and as the fallback. A socket is an
 * optimisation; the bell has to work without one, and does.
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const queryClient = useQueryClient();

  const { connected } = useNotificationSocket();

  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => clientFetch<NotificationFeed>('/notifications?limit=20'),
    // Only while the push is not working, and never in a hidden tab.
    refetchInterval: () =>
      connected || (typeof document !== 'undefined' && document.visibilityState === 'hidden')
        ? false
        : FALLBACK_POLL_MS,
    refetchOnWindowFocus: true,
  });

  const feed = data?.data;
  const unread = feed?.unread ?? 0;
  const items = feed?.items ?? [];

  const markRead = useMutation({
    mutationFn: (body: { ids?: string[]; all?: boolean }) =>
      clientFetch<NotificationFeed>('/notifications/read', { method: 'POST', body }),
    onSuccess: (result) => {
      // The endpoint answers with the fresh feed, so the cache is replaced
      // rather than invalidated — no second round trip to show the same thing.
      queryClient.setQueryData(['notifications'], result);
    },
  });

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={
          unread > 0 ? `Notifikasi — ${unread} belum dibaca` : 'Notifikasi — tidak ada yang baru'
        }
        className="relative rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
      >
        <Bell className="h-5 w-5" aria-hidden />
        {unread > 0 && (
          <span
            aria-hidden
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white"
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-96 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900"
        >
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Notifikasi</p>
            {unread > 0 && (
              <Button
                variant="ghost"
                size="sm"
                loading={markRead.isPending}
                leftIcon={<CheckCheck className="h-3.5 w-3.5" aria-hidden />}
                onClick={() => markRead.mutate({ all: true })}
              >
                Tandai semua
              </Button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-500">
                Belum ada notifikasi.
              </p>
            ) : (
              items.map((item) => (
                <NotificationRow
                  key={item.id}
                  item={item}
                  onOpen={() => {
                    setOpen(false);
                    if (!item.readAt) markRead.mutate({ ids: [item.id] });
                  }}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function NotificationRow({ item, onOpen }: { item: NotificationView; onOpen: () => void }) {
  const body = (
    <>
      <span className="flex items-start gap-2">
        {/* An unread marker rather than a whole-row tint: the row still has to
            be readable, and a wash of colour on half the list is not a signal. */}
        <span
          aria-hidden
          className={cn(
            'mt-1.5 h-2 w-2 shrink-0 rounded-full',
            item.readAt ? 'bg-transparent' : 'bg-sky-500',
          )}
        />
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              'block text-sm text-slate-900 dark:text-slate-100',
              !item.readAt && 'font-semibold',
            )}
          >
            {item.title}
          </span>
          {item.body && (
            <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
              {item.body}
            </span>
          )}
          <span className="mt-0.5 block text-[11px] text-slate-400">
            <DateTime value={item.createdAt} relative />
          </span>
        </span>
      </span>
    </>
  );

  const className =
    'block w-full px-4 py-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800';

  if (!item.link) {
    return (
      <button type="button" onClick={onOpen} className={className}>
        {body}
      </button>
    );
  }

  return (
    <Link href={dynamicRoute(item.link)} onClick={onOpen} className={className}>
      {body}
    </Link>
  );
}
