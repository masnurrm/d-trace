'use client';

import { useQuery } from '@tanstack/react-query';
import { TrendingUp, UserCheck, UserX, Users } from 'lucide-react';
import { clientFetch } from '@/lib/api/client';
import { StatCard } from '@/components/ui/stat-card';

export interface UserStats {
  total: number;
  active: number;
  inactive: number;
  newThisMonth: number;
}

/**
 * The four counts above the user list.
 *
 * They come from their own endpoint rather than from the table's pagination
 * meta: the table shows a filtered page, and a card that changes meaning when
 * someone types in the search box is worse than no card at all.
 */
export function UserStatsCards({ initial }: { initial: UserStats }) {
  const { data = initial } = useQuery({
    queryKey: ['user-stats'],
    queryFn: async () => (await clientFetch<UserStats>('/users/stats')).data,
    initialData: initial,
  });

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Total User" value={data.total} Icon={Users} />
      <StatCard label="User Aktif" value={data.active} Icon={UserCheck} />
      <StatCard label="User Nonaktif" value={data.inactive} Icon={UserX} />
      <StatCard label="User Baru Bulan Ini" value={data.newThisMonth} Icon={TrendingUp} />
    </div>
  );
}
