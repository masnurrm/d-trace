'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import type { SessionUser } from '@dtrace/shared';
import { postAuth } from '@/lib/api/client';

/** `Super Admin` -> `SA`; a single initial when there is only one word. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

/** The signed-in account at the foot of the sidebar, with sign-out. */
export function UserCard({ user }: { user: SessionUser }) {
  const router = useRouter();

  const signOut = useMutation({
    mutationFn: () => postAuth('/logout'),
    // Even if revocation upstream failed, the local cookies are gone, so the
    // user must end up on the sign-in screen either way.
    onSettled: () => {
      router.replace('/login');
      router.refresh();
    },
  });

  return (
    <div className="flex items-center gap-3 rounded-lg px-2 py-2">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-700 text-xs font-semibold text-white">
        {initialsOf(user.name)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-white">{user.name}</p>
        <p className="truncate text-xs text-slate-400">{user.role}</p>
      </div>
      <button
        type="button"
        onClick={() => signOut.mutate()}
        disabled={signOut.isPending}
        aria-label="Keluar"
        title="Keluar"
        className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white disabled:opacity-50"
      >
        <LogOut className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
