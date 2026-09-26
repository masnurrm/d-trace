'use client';

import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useFormContext } from 'react-hook-form';
import { Send } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { SelectField, TextField } from '@/components/ui/field';
import { ApiClientError, clientFetch } from '@/lib/api/client';
import type { SettingsFormValues } from './form-schema';

const ENCRYPTION_OPTIONS = [
  { value: 'STARTTLS', label: 'STARTTLS (umumnya port 587)' },
  { value: 'SSL_TLS', label: 'SSL/TLS (umumnya port 465)' },
  { value: 'NONE', label: 'Tanpa enkripsi (tidak disarankan)' },
];

export function EmailTab({ hasStoredPassword }: { hasStoredPassword: boolean }) {
  const {
    register,
    formState: { errors, isDirty },
  } = useFormContext<SettingsFormValues>();

  const [testTo, setTestTo] = useState('');
  const [result, setResult] = useState<{ tone: 'success' | 'danger'; message: string } | null>(null);

  const sendTest = useMutation({
    mutationFn: (to: string) =>
      clientFetch<{ sent: boolean }>('/settings/email/test', { method: 'POST', body: { to } }),
    onMutate: () => {
      setResult(null);
    },
    onSuccess: (_data, to) => {
      setResult({ tone: 'success', message: `Email uji terkirim ke ${to}.` });
    },
    onError: (error) => {
      setResult({
        tone: 'danger',
        message: error instanceof ApiClientError ? error.message : 'Gagal mengirim email uji.',
      });
    },
  });

  return (
    <>
      <Card>
        <CardHeader
          title="Konfigurasi Email (SMTP)"
          description="Dipakai untuk mengirim email keluar dari D-Trace."
        />
        <CardBody className="space-y-5">
          <div className="grid gap-5 lg:grid-cols-2">
            <TextField
              label="Host SMTP"
              placeholder="smtp.contoh.com"
              error={errors.email?.host?.message}
              {...register('email.host')}
            />
            <TextField
              label="Port"
              type="number"
              min={1}
              max={65535}
              placeholder="587"
              error={errors.email?.port?.message}
              {...register('email.port')}
            />
          </div>

          <SelectField
            label="Keamanan"
            options={ENCRYPTION_OPTIONS}
            hint="STARTTLS menaikkan sambungan biasa ke terenkripsi; SSL/TLS terenkripsi sejak awal."
            error={errors.email?.encryption?.message}
            {...register('email.encryption')}
          />

          <div className="grid gap-5 lg:grid-cols-2">
            <TextField
              label="Username"
              autoComplete="off"
              error={errors.email?.username?.message}
              {...register('email.username')}
            />
            <TextField
              label="Password"
              type="password"
              autoComplete="new-password"
              placeholder={hasStoredPassword ? '•••••••• tersimpan' : ''}
              // The stored password is never sent to the browser; leaving this
              // blank keeps whatever is on the server.
              hint={
                hasStoredPassword
                  ? 'Sudah tersimpan dan terenkripsi. Kosongkan bila tidak ingin mengubahnya.'
                  : 'Disimpan terenkripsi (AES-256-GCM) dan tidak pernah ditampilkan lagi.'
              }
              error={errors.email?.password?.message}
              {...register('email.password')}
            />
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <TextField
              label="Nama pengirim"
              placeholder="D-Trace"
              error={errors.email?.fromName?.message}
              {...register('email.fromName')}
            />
            <TextField
              label="Email pengirim"
              type="email"
              placeholder="no-reply@contoh.com"
              error={errors.email?.fromEmail?.message}
              {...register('email.fromEmail')}
            />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Kirim Email Uji"
          description="Memakai konfigurasi yang sudah tersimpan di server, bukan yang sedang diketik."
        />
        <CardBody className="space-y-4">
          {isDirty && (
            <Alert tone="warning">
              Ada perubahan yang belum disimpan. Simpan dulu supaya email uji memakai konfigurasi
              yang baru.
            </Alert>
          )}

          {result && <Alert tone={result.tone}>{result.message}</Alert>}

          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-64 flex-1">
              <TextField
                label="Kirim ke"
                type="email"
                name="test-email-to"
                placeholder="anda@contoh.com"
                value={testTo}
                onChange={(event) => setTestTo(event.target.value)}
              />
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => sendTest.mutate(testTo)}
              loading={sendTest.isPending}
              disabled={!testTo.trim() || sendTest.isPending}
              leftIcon={<Send className="h-4 w-4" aria-hidden />}
            >
              Kirim uji
            </Button>
          </div>

          <p className="text-xs text-slate-500 dark:text-slate-400">
            Dibatasi 5 kali per 10 menit, dan setiap percobaan tercatat di Audit Log.
          </p>
        </CardBody>
      </Card>
    </>
  );
}
