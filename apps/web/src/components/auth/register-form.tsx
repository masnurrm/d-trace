'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { registerSchema, type RegisterInput, type SessionUser } from '@dtrace/shared';
import { postAuth } from '@/lib/api/client';
import { useFormMutation } from '@/lib/query/use-form-mutation';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/field';

export function RegisterForm() {
  const router = useRouter();

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: '', email: '', password: '', confirmPassword: '' },
  });

  const { mutate, isPending, formError } = useFormMutation<RegisterInput, { user: SessionUser }>({
    setError,
    mutationFn: (values) => postAuth<{ user: SessionUser }>('/register', values),
    onSuccess: () => {
      router.replace('/dashboard');
      router.refresh();
    },
  });

  return (
    <form onSubmit={handleSubmit((values) => mutate(values))} className="space-y-4" noValidate>
      {formError && <Alert tone="danger">{formError}</Alert>}

      <TextField
        label="Nama lengkap"
        autoComplete="name"
        autoFocus
        error={errors.name?.message}
        {...register('name')}
      />

      <TextField
        label="Email"
        type="email"
        autoComplete="email"
        error={errors.email?.message}
        {...register('email')}
      />

      <TextField
        label="Password"
        type="password"
        autoComplete="new-password"
        hint="Minimal 12 karakter, mengandung huruf besar dan angka."
        error={errors.password?.message}
        {...register('password')}
      />

      <TextField
        label="Ulangi password"
        type="password"
        autoComplete="new-password"
        error={errors.confirmPassword?.message}
        {...register('confirmPassword')}
      />

      <Button type="submit" block loading={isPending}>
        Buat akun
      </Button>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        Akun baru dimulai dengan akses baca saja. Administrator yang menaikkan aksesnya.
      </p>
    </form>
  );
}
