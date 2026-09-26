import type { Metadata } from 'next';
import { ROLES, hasAtLeastRole, type PermissionMatrixView, type Role } from '@dtrace/shared';
import { apiFetch, getSessionUser } from '@/lib/api/server';
import { PermissionMatrixEditor } from '@/components/permissions/permission-matrix';

export const metadata: Metadata = { title: 'Role & Akses' };
export const dynamic = 'force-dynamic';

export default async function RoleAccessPage() {
  const [user, matrix] = await Promise.all([
    getSessionUser(),
    apiFetch<PermissionMatrixView>('/role-permissions'),
  ]);

  const canEdit = hasAtLeastRole((user?.role ?? ROLES.VIEWER) as Role, ROLES.ADMIN);

  return <PermissionMatrixEditor initial={matrix.data} canEdit={canEdit} />;
}
