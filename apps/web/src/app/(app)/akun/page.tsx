import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import type { UserSignatureView } from '@dtrace/shared';
import { redirect } from 'next/navigation';
import { ROLE_LABELS, type Role } from '@dtrace/shared';
import { ApiRequestError, apiFetch, getSessionUser } from '@/lib/api/server';
import { SetBreadcrumbs } from '@/components/layout/breadcrumb-context';
import { SignatureCard } from '@/components/account/signature-card';
import { ChangePasswordForm } from '@/components/auth/change-password-form';
import { SignOutEverywhere } from '@/components/auth/sign-out-everywhere';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { DateTime } from '@/components/ui/date-time';

export const metadata: Metadata = { title: 'Akun Saya' };
export const dynamic = 'force-dynamic';

/**
 * The account page, reached from the name in the header.
 *
 * It sits directly under `(app)` rather than in either half, like `/bantuan`:
 * an account belongs to the person, not to the Workspace or the Admin Panel,
 * and `modeForPath()` leaves the sidebar on whichever half they came from.
 *
 * `ChangePasswordForm` and `SignOutEverywhere` were both written earlier and
 * had no page to live on. This is it.
 */
export default async function AccountPage() {
  const [user, signature] = await Promise.all([getSessionUser(), loadSignature()]);
  // The proxy already gates this route; this is the belt to that braces, and
  // it is what makes `user` non-null for the rest of the page.
  if (!user) redirect('/login');

  return (
    <div className="space-y-6">
      <SetBreadcrumbs trail={[{ label: 'Akun Saya' }]} />

      <PageHeader
        title="Akun Saya"
        description="Data akun Anda, dan hal-hal yang hanya Anda sendiri boleh ubah."
      />

      <Card>
        <CardHeader title="Profil" description="Dikelola oleh administrator." tinted />
        <CardBody>
          <dl className="grid gap-4 sm:grid-cols-2">
            <Field label="Nama" value={user.name} />
            <Field label="Email" value={user.email} />
            <Field label="Role sistem" value={ROLE_LABELS[user.role as Role] ?? user.role} />
            <Field label="Bergabung" value={<DateTime value={user.createdAt} />} />
          </dl>
          <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
            Nama, email, dan role hanya bisa diubah oleh administrator melalui menu User.
          </p>
        </CardBody>
      </Card>

      <SignatureCard signature={signature} verifyBase="/dokumen" />

      <Card>
        <CardHeader
          title="Ganti password"
          description="Mengganti password akan mengeluarkan Anda dari semua perangkat."
          tinted
        />
        <CardBody>
          <ChangePasswordForm />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Keamanan sesi"
          description="Gunakan ini bila Anda menduga sesi Anda dipakai orang lain."
          tinted
        />
        <CardBody>
          <SignOutEverywhere />
        </CardBody>
      </Card>
    </div>
  );
}

/** A signature nobody has set yet is a null, not an error. */
async function loadSignature(): Promise<UserSignatureView | null> {
  try {
    const result = await apiFetch<UserSignatureView | null>('/auth/me/signature');
    return result.data;
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) return null;
    throw error;
  }
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="text-sm font-medium text-slate-900 dark:text-slate-100">{value}</dd>
    </div>
  );
}
