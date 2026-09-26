import type { Metadata } from 'next';
import Link from 'next/link';
import { RegisterForm } from '@/components/auth/register-form';
import { Card, CardBody, CardHeader } from '@/components/ui/card';

export const metadata: Metadata = { title: 'Daftar' };

export default function RegisterPage() {
  return (
    <Card>
      <CardHeader title="Daftar" description="Akses awal hanya baca." />
      <CardBody className="space-y-4">
        <RegisterForm />
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Sudah punya akun?{' '}
          <Link href="/login" className="font-medium text-sky-600 hover:underline">
            Masuk
          </Link>
        </p>
      </CardBody>
    </Card>
  );
}
