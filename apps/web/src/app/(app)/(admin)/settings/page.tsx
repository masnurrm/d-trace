import type { Metadata } from 'next';
import { ROLES, hasAtLeastRole, type Role } from '@dtrace/shared';
import { getSessionUser } from '@/lib/api/server';
import { getSettings } from '@/lib/api/settings';
import { Alert } from '@/components/ui/alert';
import { SettingsForm } from '@/components/settings/settings-form';

export const metadata: Metadata = { title: 'Pengaturan' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const [user, settings] = await Promise.all([getSessionUser(), getSettings()]);
  const isAdmin = hasAtLeastRole((user?.role ?? ROLES.VIEWER) as Role, ROLES.ADMIN);

  // The API refuses the write regardless; this only avoids showing a form whose
  // save button could never succeed.
  if (!isAdmin) {
    return (
      <Alert tone="warning" title="Akses terbatas">
        Halaman Pengaturan hanya untuk role ADMIN.
      </Alert>
    );
  }

  return <SettingsForm settings={settings} />;
}
