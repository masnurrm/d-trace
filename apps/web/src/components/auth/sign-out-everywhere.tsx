'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { ApiClientError, clientFetch, postAuth } from '@/lib/api/client';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

/**
 * The remedy for "I think someone else has my session": one call revokes every
 * refresh token for the account, so every other device is signed out too.
 */
export function SignOutEverywhere() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const revokeAll = useMutation({
    mutationFn: async () => {
      await clientFetch<{ revoked: number }>('/auth/logout-all', { method: 'POST' });
      await postAuth('/logout').catch(() => undefined);
    },
    onMutate: () => {
      setError(null);
    },
    onSuccess: () => {
      router.replace('/login');
      router.refresh();
    },
    onError: (caught) => {
      setError(caught instanceof ApiClientError ? caught.message : 'Could not revoke sessions.');
    },
  });

  return (
    <div className="space-y-3">
      {error && <Alert tone="danger">{error}</Alert>}

      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="destructive" loading={revokeAll.isPending} onClick={() => revokeAll.mutate()}>
            Yes, sign out everywhere
          </Button>
          <Button variant="ghost" onClick={() => setConfirming(false)} disabled={revokeAll.isPending}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button
          variant="outline"
          onClick={() => setConfirming(true)}
          leftIcon={<ShieldAlert className="h-4 w-4" aria-hidden />}
        >
          Sign out of all devices
        </Button>
      )}
    </div>
  );
}
