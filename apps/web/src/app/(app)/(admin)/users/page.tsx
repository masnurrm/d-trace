import type { Metadata } from 'next';
import { ROLES, hasAtLeastRole, type Role, type User } from '@dtrace/shared';
import { apiFetch, getSessionUser } from '@/lib/api/server';
import { PageHeader } from '@/components/ui/page-header';
import { UsersPanel } from '@/components/users/users-panel';
import { UserStatsCards, type UserStats } from '@/components/users/user-stats';
import { usersSearchString } from '@/components/users/query';

export const metadata: Metadata = { title: 'User' };
export const dynamic = 'force-dynamic';

/**
 * The first page is fetched on the server, so the table arrives with the HTML:
 * no loading flash, and no token in the browser. From there TanStack Query owns
 * the list — filtering and paging never touch this component again.
 */
export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const sessionUser = await getSessionUser();
  const isAdmin = hasAtLeastRole((sessionUser?.role ?? ROLES.VIEWER) as Role, ROLES.ADMIN);

  const incoming = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') incoming.set(key, value);
  }

  // The same parser the panel uses, so the cache key it builds on hydration
  // matches this prefetch exactly and the list is not fetched twice.
  const search = usersSearchString(incoming);
  const [initialResult, stats] = await Promise.all([
    apiFetch<User[]>(`/users?${search}`),
    apiFetch<UserStats>('/users/stats'),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="User"
        description="Daftar akun dan role-nya. Mengubah role akan mencabut sesi user tersebut."
      />

      <UserStatsCards initial={stats.data} />

      <UsersPanel
        initialSearch={search}
        initialResult={initialResult}
        isAdmin={isAdmin}
        currentUserId={sessionUser?.id ?? null}
      />
    </div>
  );
}
