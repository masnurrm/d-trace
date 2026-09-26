'use client';

import { useFormContext } from 'react-hook-form';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { TextField } from '@/components/ui/field';
import type { SettingsFormValues } from './form-schema';

export function IdentityTab({ version }: { version: string }) {
  const {
    register,
    formState: { errors },
  } = useFormContext<SettingsFormValues>();

  return (
    <Card>
      <CardHeader
        title="Identitas Aplikasi"
        description="Nama dan tagline yang tampil di sidebar dan judul halaman."
      />
      <CardBody className="space-y-5">
        <div className="grid gap-5 lg:grid-cols-2">
          <TextField
            label="Nama aplikasi"
            error={errors.identity?.appName?.message}
            {...register('identity.appName')}
          />
          <TextField
            label="Tagline"
            hint="Kalimat pendek di bawah nama aplikasi. Boleh dikosongkan."
            error={errors.identity?.tagline?.message}
            {...register('identity.tagline')}
          />
        </div>

        <div className="space-y-1.5">
          <p className="block text-sm font-medium text-slate-700 dark:text-slate-300">Versi</p>
          <p className="inline-block rounded bg-slate-100 px-2 py-1 font-mono text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-200">
            {version}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Dibaca dari build, tidak bisa diketik — supaya nomor yang tampil selalu sama dengan yang
            benar-benar terpasang.
          </p>
        </div>
      </CardBody>
    </Card>
  );
}
