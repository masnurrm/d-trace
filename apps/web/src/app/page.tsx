import { redirect } from 'next/navigation';
import { ROLES, defaultModeFor, type Role } from '@dtrace/shared';
import { getSessionUser } from '@/lib/api/server';
import { MODE_HOME } from '@/components/layout/navigation';

/**
 * There is no marketing page here: middleware has already decided whether the
 * visitor has a session, so the root just forwards to the half of the app this
 * account belongs in. A super admin lands in the Admin Panel; everyone else
 * lands in their Workspace — which is also the only half they can reach.
 */
export default async function HomePage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  redirect(MODE_HOME[defaultModeFor((user.role ?? ROLES.VIEWER) as Role)]);
}
