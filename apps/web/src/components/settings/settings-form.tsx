'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { Save } from 'lucide-react';
import type { AppSettingsView } from '@dtrace/shared';
import { ApiClientError, clientFetch } from '@/lib/api/client';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Tabs, TabPanel } from '@/components/ui/tabs';
import { settingsFormSchema, toApiPayload, toFormValues, type SettingsFormValues } from './form-schema';
import { IdentityTab } from './identity-tab';
import { RunningTextTab } from './running-text-tab';
import { FooterTab } from './footer-tab';
import { EmailTab } from './email-tab';

const TABS = [
  { id: 'identitas', label: 'Identitas' },
  { id: 'running-text', label: 'Running Text' },
  { id: 'footer', label: 'Footer' },
  { id: 'email', label: 'Email Config' },
];

/**
 * One form across all four tabs, saved with a single request.
 *
 * Switching tabs does not submit and does not discard: an operator who edits
 * the footer and the marquee saves both together, which also keeps the server
 * from seeing a half-applied configuration.
 */
export function SettingsForm({ settings }: { settings: AppSettingsView }) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState(TABS[0]!.id);
  const [baseVersion, setBaseVersion] = useState(settings.updatedAt);
  const [status, setStatus] = useState<{ tone: 'success' | 'danger'; message: string } | null>(null);

  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsFormSchema),
    defaultValues: toFormValues(settings),
    mode: 'onSubmit',
  });

  const {
    handleSubmit,
    reset,
    formState: { isDirty },
  } = form;

  const save = useMutation({
    mutationFn: (values: SettingsFormValues) =>
      clientFetch<AppSettingsView>('/settings', {
        method: 'PUT',
        body: toApiPayload(values, baseVersion),
      }),
    onMutate: () => {
      setStatus(null);
    },
    onSuccess: (saved) => {
      // Re-seed from the server's response: it assigns ids to newly added
      // marquee items, and re-seeding is what makes the form clean again.
      reset(toFormValues(saved.data));
      setBaseVersion(saved.data.updatedAt);
      setStatus({ tone: 'success', message: 'Perubahan tersimpan.' });

      // The shell reads these settings too (app name, marquee, footer).
      router.refresh();
    },
    onError: (error) => {
      if (error instanceof ApiClientError) {
        // CONFLICT means someone else saved while this page was open. Saying so
        // is the whole point: the alternative is silently erasing their work.
        if (error.code === 'CONFLICT') {
          setStatus({ tone: 'danger', message: error.message });
          return;
        }

        const [firstDetail] = error.details ?? [];
        setStatus({
          tone: 'danger',
          message: firstDetail ? `${firstDetail.field}: ${firstDetail.message}` : error.message,
        });
        return;
      }
      setStatus({ tone: 'danger', message: 'Gagal menyimpan. Periksa sambungan lalu coba lagi.' });
    },
  });

  return (
    <FormProvider {...form}>
      <form onSubmit={handleSubmit((values) => save.mutate(values))} className="space-y-6" noValidate>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
              Pengaturan
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Atur identitas aplikasi, running text di header, dan footer.
            </p>
          </div>

          <Button
            type="submit"
            loading={save.isPending}
            // Nothing changed means nothing to send; the disabled state also
            // tells the operator their edits are already saved.
            disabled={!isDirty || save.isPending}
            leftIcon={<Save className="h-4 w-4" aria-hidden />}
          >
            Simpan Perubahan
          </Button>
        </div>

        {status && <Alert tone={status.tone}>{status.message}</Alert>}

        <Tabs tabs={TABS} active={activeTab} onChange={setActiveTab} />

        <TabPanel id="identitas" active={activeTab}>
          <IdentityTab version={settings.identity.version} />
        </TabPanel>

        <TabPanel id="running-text" active={activeTab}>
          <RunningTextTab />
        </TabPanel>

        <TabPanel id="footer" active={activeTab}>
          <FooterTab />
        </TabPanel>

        <TabPanel id="email" active={activeTab}>
          <EmailTab hasStoredPassword={settings.email?.hasPassword ?? false} />
        </TabPanel>
      </form>
    </FormProvider>
  );
}
