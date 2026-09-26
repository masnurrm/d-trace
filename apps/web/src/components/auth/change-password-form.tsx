'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { changePasswordSchema, type ChangePasswordInput } from '@dtrace/shared';
import { clientFetch, postAuth } from '@/lib/api/client';
import { useFormMutation } from '@/lib/query/use-form-mutation';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/field';

/**
 * Changing a password revokes every session server-side, including this one,
 * so the only correct thing to do afterwards is sign out and back in. The form
 * says so before submitting, then does exactly that.
 */
export function ChangePasswordForm() {
  const router = useRouter();

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const { mutate, isPending, formError } = useFormMutation<ChangePasswordInput>({
    setError,
    fallbackMessage: 'Server tidak dapat dihubungi. Coba lagi.',
    mutationFn: (values) => clientFetch('/auth/change-password', { method: 'POST', body: values }),
    onSuccess: async () => {
      // The API has already invalidated the session; clear the local cookies
      // so the browser is not left holding a token that no longer works.
      await postAuth('/logout').catch(() => undefined);
      router.replace('/login?changed=1');
      router.refresh();
    },
  });

  return (
    <form onSubmit={handleSubmit((values) => mutate(values))} className="max-w-md space-y-4" noValidate>
      {formError && <Alert tone="danger">{formError}</Alert>}

      <Alert tone="warning">
        Changing your password signs you out of every device, including this one.
      </Alert>

      <TextField
        label="Current password"
        type="password"
        autoComplete="current-password"
        error={errors.currentPassword?.message}
        {...register('currentPassword')}
      />

      <TextField
        label="New password"
        type="password"
        autoComplete="new-password"
        hint="At least 12 characters, with an uppercase letter and a digit."
        error={errors.newPassword?.message}
        {...register('newPassword')}
      />

      <TextField
        label="Confirm new password"
        type="password"
        autoComplete="new-password"
        error={errors.confirmPassword?.message}
        {...register('confirmPassword')}
      />

      <Button type="submit" loading={isPending}>
        Change password
      </Button>
    </form>
  );
}
