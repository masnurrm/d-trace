import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { ROLES, canOpenAdminPanel, type Role } from '@dtrace/shared';
import { getSessionUser } from '@/lib/api/server';

/**
 * The Admin Panel boundary.
 *
 * Every route in this group configures the platform itself — accounts, the
 * hierarchy, document templates, permissions, the audit trail — so one check
 * here covers all of them, and adding a page to the group cannot accidentally
 * ship it ungated.
 *
 * `ADMIN` deliberately does not pass: it is the role a person carries inside a
 * workspace, not a smaller key to this door. Only `SUPER_ADMIN` opens it.
 *
 * This is a redirect, not a 403: a signed-in user who never had the panel is
 * better served by being put somewhere useful than by being told off. The API
 * refuses the underlying calls regardless — this only decides what renders.
 */
export default async function AdminPanelLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  if (!canOpenAdminPanel((user.role ?? ROLES.VIEWER) as Role)) {
    redirect('/workspace');
  }

  return <>{children}</>;
}
