import type { Metadata } from 'next';
import { Activity, ShieldCheck, UserCheck, Users } from 'lucide-react';
import { ROLES, hasAtLeastRole, type AuditLog, type Role, type User } from '@dtrace/shared';
import { apiFetch, getSessionUser } from '@/lib/api/server';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Badge, RoleBadge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import { DateTime } from '@/components/ui/date-time';

export const metadata: Metadata = { title: 'Dashboard' };

/** Per-user data: never prerendered, never cached. */
export const dynamic = 'force-dynamic';

const activityColumns: Column<AuditLog>[] = [
  {
    key: 'action',
    header: 'Aksi',
    cell: (row) => (
      <Badge tone={row.action.endsWith('FAILED') ? 'danger' : 'neutral'}>{row.action}</Badge>
    ),
  },
  {
    key: 'actor',
    header: 'Pelaku',
    cell: (row) => row.actorEmail ?? '—',
  },
  {
    key: 'when',
    header: 'Waktu',
    cell: (row) => <DateTime value={row.createdAt} relative />,
    className: 'whitespace-nowrap text-slate-500',
  },
];

export default async function DashboardPage() {
  const user = await getSessionUser();
  const role = (user?.role ?? ROLES.VIEWER) as Role;
  const canSeeTrail = hasAtLeastRole(role, ROLES.AUDITOR);

  // A VIEWER has no access to these endpoints, so the widgets are only
  // requested when the role allows it - a 403 is not an error state to render.
  const [users, activeUsers, recentActivity] = canSeeTrail
    ? await Promise.all([
        apiFetch<User[]>('/users?limit=1'),
        apiFetch<User[]>('/users?limit=1&isActive=true'),
        apiFetch<AuditLog[]>('/audit-logs?limit=8'),
      ])
    : [null, null, null];

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Selamat datang, ${user?.name.split(' ')[0] ?? 'Anda'}`}
        description="Ringkasan akun dan aktivitas terakhir yang terekam."
      />

      {!canSeeTrail && (
        <Alert tone="info" title="Akses baca saja">
          Role Anda bisa masuk dan mengelola akun sendiri. Minta administrator menaikkan ke AUDITOR
          atau lebih untuk melihat manajemen user dan audit log.
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Role Anda" value={role} Icon={ShieldCheck} hint="Ditegakkan oleh API" />
        {canSeeTrail && (
          <>
            <StatCard label="User" value={users?.meta?.total ?? 0} Icon={Users} />
            <StatCard label="User aktif" value={activeUsers?.meta?.total ?? 0} Icon={UserCheck} />
            <StatCard
              label="Catatan audit"
              value={recentActivity?.meta?.total ?? 0}
              Icon={Activity}
              hint="Hanya bisa bertambah"
            />
          </>
        )}
      </div>

      {canSeeTrail && (
        <Card>
          <CardHeader title="Aktivitas terakhir" description="Delapan kejadian terakhir yang terekam." />
          <DataTable
            columns={activityColumns}
            rows={recentActivity?.data ?? []}
            rowKey={(row) => row.id}
            caption="Catatan audit terakhir"
            emptyMessage="Belum ada aktivitas terekam."
          />
        </Card>
      )}

      <Card>
        <CardHeader title="Akun Anda" />
        <CardBody className="grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Nama</p>
            <p className="text-sm font-medium">{user?.name}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Email</p>
            <p className="text-sm font-medium">{user?.email}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Role</p>
            <RoleBadge role={role} />
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
