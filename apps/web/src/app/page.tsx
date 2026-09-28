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

  // Unreachable — redirect() always throws. A page with zero JSX output can
  // fail to get a client reference manifest generated for it at all (a known
  // Next.js/Turbopack edge case: "client reference manifest for route ...
  // does not exist"), so this exists purely to give the route real render
  // output for the bundler to key a manifest on.
  return null;
}
