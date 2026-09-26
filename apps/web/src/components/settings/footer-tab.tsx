'use client';

import { Controller, useFormContext } from 'react-hook-form';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { SelectField, TextField } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import type { SettingsFormValues } from './form-schema';

const ALIGNMENT_OPTIONS = [
  { value: 'LEFT', label: 'Rata kiri' },
  { value: 'CENTER', label: 'Rata tengah' },
  { value: 'RIGHT', label: 'Rata kanan' },
];

export function FooterTab() {
  const {
    register,
    control,
    formState: { errors },
  } = useFormContext<SettingsFormValues>();

  return (
    <Card>
      <CardHeader title="Footer" description="Baris keterangan di kaki setiap halaman." />
      <CardBody className="space-y-5">
        <TextField
          label="Teks footer"
          hint="Misalnya nama perusahaan dan tahun. Boleh dikosongkan."
          error={errors.footer?.text?.message}
          {...register('footer.text')}
        />

        <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
          <SelectField
            label="Perataan"
            options={ALIGNMENT_OPTIONS}
            error={errors.footer?.align?.message}
            {...register('footer.align')}
          />

          <div className="space-y-3 lg:pt-7">
            <Controller
              control={control}
              name="footer.showAppName"
              render={({ field }) => (
                <Switch
                  checked={field.value}
                  onChange={field.onChange}
                  label="Tampilkan nama aplikasi"
                />
              )}
            />
            <Controller
              control={control}
              name="footer.showVersion"
              render={({ field }) => (
                <Switch checked={field.value} onChange={field.onChange} label="Tampilkan versi" />
              )}
            />
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
