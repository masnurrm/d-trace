'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, Lock, Mail } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { loginSchema, ROLES, defaultModeFor, type LoginInput, type Role, type SessionUser } from '@dtrace/shared';
import { MODE_HOME } from '@/components/layout/navigation';
import { postAuth } from '@/lib/api/client';
import { useFormMutation } from '@/lib/query/use-form-mutation';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { PasswordField, TextField } from '@/components/ui/field';
import { dynamicRoute } from '@/lib/utils/routes';

/**
 * "Ingat saya" remembers the email only, in this browser. A remembered session
 * would mean a longer-lived credential, which is the API's decision to make —
 * never the form's.
 */
const REMEMBERED_EMAIL_KEY = 'dtrace.login.email';

/** The stored email cannot change while this page is open, so nothing to subscribe to. */
const subscribeToNothing = () => () => {};

/**
 * The form validates against the very same schema the API uses, imported from
 * @dtrace/shared. Client-side validation is a convenience for the user; the
 * server revalidates because a browser can be bypassed.
 */
export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Read through useSyncExternalStore rather than in an effect: it yields the
  // empty server snapshot during SSR and the stored value after hydration, so
  // the checkbox has its real state on the first client render.
  const rememberedEmail = useSyncExternalStore(
    subscribeToNothing,
    () => window.localStorage.getItem(REMEMBERED_EMAIL_KEY) ?? '',
    () => '',
  );
  const [rememberOverride, setRememberOverride] = useState<boolean | null>(null);
  const remember = rememberOverride ?? rememberedEmail !== '';

  const {
    register,
    handleSubmit,
    setError,
    setValue,
    formState: { errors },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  useEffect(() => {
    if (rememberedEmail) setValue('email', rememberedEmail);
  }, [rememberedEmail, setValue]);

  const { mutate, isPending, formError } = useFormMutation<LoginInput, { user: SessionUser }>({
    setError,
    mutationFn: (values) => postAuth<{ user: SessionUser }>('/login', values),
    onSuccess: (data, values) => {
      if (remember) window.localStorage.setItem(REMEMBERED_EMAIL_KEY, values.email);
      else window.localStorage.removeItem(REMEMBERED_EMAIL_KEY);

      // `next` is validated as a relative path: an open redirect here would
      // let a phishing link bounce a freshly signed-in user off-site.
      const next = searchParams.get('next');
      // With no `next`, land directly on the account's half instead of routing
      // through `/` (which only exists to do this same lookup server-side) —
      // avoids a client-side navigation to a page whose entire body is a
      // redirect, which Next/Turbopack has been unreliable about serving.
      const destination =
        next && next.startsWith('/') && !next.startsWith('//')
          ? next
          : MODE_HOME[defaultModeFor((data.user.role ?? ROLES.VIEWER) as Role)];

      router.replace(dynamicRoute(destination));
      router.refresh();
    },
  });

  return (
    <form onSubmit={handleSubmit((values) => mutate(values))} className="mt-6 space-y-4" noValidate>
      {formError && <Alert tone="danger">{formError}</Alert>}

      <TextField
        label="Email"
        type="email"
        autoComplete="email"
        autoFocus
        leadingIcon={<Mail className="h-4 w-4" />}
        className="bg-slate-50 dark:bg-slate-800/60"
        error={errors.email?.message}
        {...register('email')}
      />

      <PasswordField
        label="Password"
        autoComplete="current-password"
        leadingIcon={<Lock className="h-4 w-4" />}
        className="bg-slate-50 dark:bg-slate-800/60"
        error={errors.password?.message}
        {...register('password')}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Checkbox
          label="Ingat saya"
          name="remember"
          checked={remember}
          onChange={(event) => setRememberOverride(event.target.checked)}
        />
        <Link href="/bantuan" className="text-sm font-medium text-sky-600 hover:underline">
          Lupa password?
        </Link>
      </div>

      <Button type="submit" block size="lg" loading={isPending} className="relative">
        Masuk
        {!isPending && <ArrowRight className="absolute right-4 h-4 w-4" aria-hidden />}
      </Button>
    </form>
  );
}
