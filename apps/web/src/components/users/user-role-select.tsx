'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ROLE_LABELS, ROLE_VALUES, type Role, type User } from '@dtrace/shared';
import { ApiClientError, clientFetch } from '@/lib/api/client';
import { SelectControl } from '@/components/ui/field';
import { cn } from '@/lib/utils/cn';

/**
 * Inline role editor for administrators.
 *
 * It is rendered only for admins, but that is a convenience: the PATCH goes to
 * the API, which re-checks the caller's role, refuses a privilege escalation
 * and refuses to demote the last administrator. The UI cannot grant anything.
 */
export function UserRoleSelect({ userId, role }: { userId: string; role: Role }) {
  const queryClient = useQueryClient();

  // The optimistic value is held only while the request is in flight. Once the
  // list has refetched, `role` is the truth again and this goes back to null,
  // so the control can never drift from what the server actually stored.
  const [optimistic, setOptimistic] = useState<Role | null>(null);
  const [error, setError] = useState<string | null>(null);

  const changeRole = useMutation({
    mutationFn: (next: Role) =>
      clientFetch<User>(`/users/${userId}/role`, { method: 'PATCH', body: { role: next } }),
    onMutate: (next) => {
      setOptimistic(next);
      setError(null);
    },
    onSuccess: async () => {
      // Every users list is now stale, whatever filter it was keyed by.
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      setOptimistic(null);
    },
    onError: (caught) => {
      setOptimistic(null);
      setError(caught instanceof ApiClientError ? caught.message : 'Could not change the role.');
    },
  });

  const value = optimistic ?? role;

  return (
    <div className="space-y-1">
      <SelectControl
        id={`role-${userId}`}
        aria-label="Role"
        value={value}
        disabled={changeRole.isPending}
        onValueChange={(next) => next && changeRole.mutate(next as Role)}
        options={ROLE_VALUES.map((option) => ({ value: option, label: ROLE_LABELS[option] }))}
        className={cn('h-8 w-40 text-xs', error && 'border-destructive')}
      />
      {error && (
        <p role="alert" className="max-w-40 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
