'use client';

import { useMutation } from '@tanstack/react-query';
import { CircleUser, KeyRound, LifeBuoy, LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { SessionUser } from '@dtrace/shared';
import { postAuth } from '@/lib/api/client';
import { DropdownMenu } from '@/components/ui/dropdown-menu';
import { initialsOf } from './user-card';

/**
 * The account menu behind the name in the header.
 *
 * The name was previously inert text beside an avatar, which is the one place
 * every user looks for "where do I change my password" and "how do I sign
 * out". It now opens the menu those two questions expect.
 */
export function UserMenu({ user }: { user: SessionUser }) {
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
    <DropdownMenu
      label={`Menu akun ${user.name}`}
      width={248}
      triggerClassName="flex items-center gap-3 px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-800"
      trigger={
        <>
          <span className="hidden text-right sm:block">
            <span className="block text-sm font-medium text-slate-900 dark:text-slate-100">
              {user.name}
            </span>
            <span className="block text-xs text-slate-500 dark:text-slate-400">{user.role}</span>
          </span>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-100">
            {initialsOf(user.name)}
          </span>
        </>
      }
      header={
        <>
          <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
            {user.name}
          </p>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">{user.email}</p>
        </>
      }
      actions={[
        {
          label: 'Profil saya',
          icon: <CircleUser className="h-4 w-4" aria-hidden />,
          onSelect: () => router.push('/akun'),
        },
        {
          label: 'Ganti password',
          icon: <KeyRound className="h-4 w-4" aria-hidden />,
          onSelect: () => router.push('/akun'),
        },
        {
          label: 'Bantuan',
          icon: <LifeBuoy className="h-4 w-4" aria-hidden />,
          onSelect: () => router.push('/bantuan'),
        },
        {
          label: 'Keluar',
          icon: <LogOut className="h-4 w-4" aria-hidden />,
          danger: true,
          disabled: signOut.isPending,
          onSelect: () => signOut.mutate(),
        },
      ]}
    />
  );
}
