'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, Lock } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { acceptInvitationSchema, type AcceptInvitationInput } from '@dtrace/shared';
import { clientFetch } from '@/lib/api/client';
import { useFormMutation } from '@/lib/query/use-form-mutation';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { PasswordField, TextField } from '@/components/ui/field';

/**
 * Turns an invitation into an account: a name and a password, twice.
 *
 * The email is not a field. It came from the invitation and is what the token
 * is bound to — letting it be typed here would turn an invitation to one
 * address into an account at another.
 */
export function AcceptInvitationForm({ token, email }: { token: string; email: string }) {
  const router = useRouter();

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<AcceptInvitationInput>({
    resolver: zodResolver(acceptInvitationSchema),
    defaultValues: { token, name: '', password: '', confirmPassword: '' },
  });

  const { mutate, isPending, formError } = useFormMutation<AcceptInvitationInput>({
    setError,
    mutationFn: (values) => clientFetch('/invitations/accept', { method: 'POST', body: values }),
    onSuccess: () => {
      // Straight to the sign-in screen rather than signing them in here: the
      // password they just chose is the one thing they should prove they know.
      router.replace('/login?invited=1');
      router.refresh();
    },
  });

  return (
    <form onSubmit={handleSubmit((values) => mutate(values))} className="mt-6 space-y-4" noValidate>
      {formError && <Alert tone="danger">{formError}</Alert>}

      <div>
        <span className="mb-1.5 block text-sm font-medium text-slate-700">Email</span>
        <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
          {email}
        </p>
      </div>

      <TextField
        label="Nama lengkap"
        autoComplete="name"
        autoFocus
        error={errors.name?.message}
        {...register('name')}
      />

      <PasswordField
        label="Password"
        autoComplete="new-password"
        leadingIcon={<Lock className="h-4 w-4" />}
        hint="Minimal 12 karakter, mengandung huruf besar dan angka."
        error={errors.password?.message}
        {...register('password')}
      />

      <PasswordField
        label="Ulangi password"
        autoComplete="new-password"
        leadingIcon={<Lock className="h-4 w-4" />}
        error={errors.confirmPassword?.message}
        {...register('confirmPassword')}
      />

      <Button type="submit" block size="lg" loading={isPending} className="relative">
        Aktifkan akun
        {!isPending && <ArrowRight className="absolute right-4 h-4 w-4" aria-hidden />}
      </Button>
    </form>
  );
}
