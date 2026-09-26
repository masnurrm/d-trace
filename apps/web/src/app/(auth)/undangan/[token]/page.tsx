import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { InvitationPreview } from '@dtrace/shared';
import { ApiRequestError, apiFetch } from '@/lib/api/server';
import { Card } from '@/components/ui/card';
import { AcceptInvitationForm } from '@/components/auth/accept-invitation-form';

export const metadata: Metadata = { title: 'Undangan' };
export const dynamic = 'force-dynamic';

/**
 * Accepting an invitation, for somebody who has no account yet.
 *
 * In the `(auth)` group because the visitor is not signed in and must not be
 * sent to the login screen by the proxy. A token that is wrong, spent or
 * expired lands on the same 404 — the page is public, and telling a stranger
 * which of those it was is telling them something.
 */
export default async function InvitationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invitation = await loadInvitation(token);
  if (!invitation) notFound();

  return (
    <Card className="rounded-2xl p-6 shadow-lg shadow-slate-900/5 sm:p-7">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">Anda diundang</h1>
      <p className="mt-1 text-sm text-slate-500">
        Buat password untuk mengaktifkan akun <strong className="text-slate-700">{invitation.email}</strong>.
      </p>

      {/* Who and what, stated plainly: a link asking for a password has to say
          on whose invitation it arrived, or it reads like a phishing page. */}
      <dl className="mt-4 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
        <div className="flex gap-2">
          <dt className="w-28 shrink-0 text-slate-500">Diundang oleh</dt>
          <dd className="min-w-0 font-medium text-slate-800">
            {invitation.invitedByName ?? 'Administrator D-Trace'}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-28 shrink-0 text-slate-500">Project</dt>
          <dd className="min-w-0 font-medium text-slate-800">
            {invitation.projectName ?? 'Belum ditentukan'}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-28 shrink-0 text-slate-500">Berlaku sampai</dt>
          <dd className="min-w-0 font-medium text-slate-800">
            {new Date(invitation.expiresAt).toLocaleDateString('id-ID', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </dd>
        </div>
      </dl>

      <AcceptInvitationForm token={token} email={invitation.email} />
    </Card>
  );
}

async function loadInvitation(token: string): Promise<InvitationPreview | null> {
  try {
    const result = await apiFetch<InvitationPreview>(
      `/invitations/token/${encodeURIComponent(token)}`,
      // No session exists yet; asking for one would 401 before the API is reached.
      { authenticated: false },
    );
    return result.data;
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) return null;
    throw error;
  }
}
