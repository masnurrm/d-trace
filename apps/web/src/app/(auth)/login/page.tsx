import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoginForm } from '@/components/auth/login-form';
import { Card } from '@/components/ui/card';

export const metadata: Metadata = { title: 'Masuk' };

export default function LoginPage() {
  return (
    <Card className="rounded-2xl p-6 shadow-lg shadow-slate-900/5 sm:p-7">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">Masuk</h1>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Gunakan email dan password akun internal Anda.
      </p>

      {/* The form reads `?next=`, which requires a Suspense boundary. */}
      <Suspense fallback={<p className="mt-6 text-sm text-slate-500">Memuat…</p>}>
        <LoginForm />
      </Suspense>
    </Card>
  );
}
