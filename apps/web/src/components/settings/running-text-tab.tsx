'use client';

import { Controller, useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import { Plus, Trash2 } from 'lucide-react';
import { isMarqueeItemActive } from '@dtrace/shared';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SelectField, TextField, TextareaField } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import { MarqueeBar } from '@/components/layout/marquee-bar';
import { formatSchedule, localInputToIso } from '@/lib/utils/datetime';
import type { SettingsFormValues } from './form-schema';

const KIND_OPTIONS = [
  { value: 'TEXT', label: 'Teks' },
  { value: 'LINK', label: 'Tautan' },
];

export function RunningTextTab() {
  const {
    register,
    control,
    formState: { errors },
  } = useFormContext<SettingsFormValues>();

  const { fields, append, remove } = useFieldArray({ control, name: 'marquee.items' });

  // Watching lets the schedule badges and the preview update as the operator
  // types, instead of only after a save.
  const marquee = useWatch({ control, name: 'marquee' });
  const itemErrors = errors.marquee?.items;

  const previewItems = (marquee?.items ?? [])
    .map((item, index) => ({
      id: fields[index]?.id ?? String(index),
      kind: item.kind,
      text: item.text,
      url: item.url || null,
      startsAt: localInputToIso(item.startsAt ?? ''),
      endsAt: localInputToIso(item.endsAt ?? ''),
      isActive: true,
    }))
    .filter((item) => item.text.trim() !== '' && isMarqueeItemActive(item));

  return (
    <>
      <Card>
        <CardHeader
          title="Running Text (Marquee)"
          description="Informasi berjalan di header, terlihat oleh semua user."
        />
        <CardBody className="grid gap-5 lg:grid-cols-2 lg:items-start">
          <Controller
            control={control}
            name="marquee.enabled"
            render={({ field }) => (
              <Switch
                checked={field.value}
                onChange={field.onChange}
                label="Tampilkan running text"
                description="Mati secara bawaan. Pengguna selalu bisa menghentikannya lewat tombol jeda."
              />
            )}
          />

          <TextField
            label="Kecepatan (detik per putaran)"
            type="number"
            min={5}
            max={300}
            hint="Lama satu putaran penuh. Angka besar berarti lambat. 5–300 detik."
            error={errors.marquee?.speedSeconds?.message}
            {...register('marquee.speedSeconds')}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Jadwal Isi"
          description="Satu baris per pengumuman, masing-masing dengan tanggalnya sendiri. Yang jadwalnya sedang berlaku tampil di header."
          action={
            <div className="flex items-center gap-2">
              <Badge>{fields.length} isi</Badge>
              <Button
                size="sm"
                onClick={() =>
                  append({ kind: 'TEXT', text: '', url: '', startsAt: '', endsAt: '' })
                }
                leftIcon={<Plus className="h-4 w-4" aria-hidden />}
              >
                Tambah Isi
              </Button>
            </div>
          }
        />

        {fields.length === 0 ? (
          <CardBody>
            <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
              Belum ada isi. Tambahkan satu untuk mulai menampilkan pengumuman.
            </p>
          </CardBody>
        ) : (
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {fields.map((field, index) => {
              const item = marquee?.items?.[index];
              const startsAt = localInputToIso(item?.startsAt ?? '');
              const endsAt = localInputToIso(item?.endsAt ?? '');
              const live = isMarqueeItemActive({ startsAt, endsAt });

              return (
                <div key={field.id} className="space-y-4 px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm">
                      <Badge>Isi {index + 1}</Badge>
                      <span className="text-slate-500 dark:text-slate-400">
                        {formatSchedule(startsAt, endsAt)}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <Badge tone={live ? 'success' : 'neutral'}>
                        {live ? 'Sedang tampil' : 'Di luar jadwal'}
                      </Badge>
                      <button
                        type="button"
                        onClick={() => remove(index)}
                        aria-label={`Hapus isi ${index + 1}`}
                        className="rounded-md p-1.5 text-red-600 transition-colors hover:bg-red-50 dark:hover:bg-red-950"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </button>
                    </div>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <SelectField
                      label="Jenis isi"
                      options={KIND_OPTIONS}
                      error={itemErrors?.[index]?.kind?.message}
                      {...register(`marquee.items.${index}.kind`)}
                    />

                    <TextareaField
                      label="Teks"
                      error={itemErrors?.[index]?.text?.message}
                      {...register(`marquee.items.${index}.text`)}
                    />
                  </div>

                  {item?.kind === 'LINK' && (
                    <TextField
                      label="Tautan"
                      type="url"
                      placeholder="https://"
                      hint="Dibuka di tab baru."
                      error={itemErrors?.[index]?.url?.message}
                      {...register(`marquee.items.${index}.url`)}
                    />
                  )}

                  <div className="grid gap-4 lg:grid-cols-2">
                    <TextField
                      label="Mulai tampil"
                      type="datetime-local"
                      error={itemErrors?.[index]?.startsAt?.message}
                      {...register(`marquee.items.${index}.startsAt`)}
                    />
                    <TextField
                      label="Berhenti tampil"
                      type="datetime-local"
                      error={itemErrors?.[index]?.endsAt?.message}
                      {...register(`marquee.items.${index}.endsAt`)}
                    />
                  </div>

                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Jam yang Anda isi adalah jam di komputer Anda. Kosongkan keduanya supaya tampil
                    terus selama running text menyala.
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Pratinjau"
          description="Hanya isi yang jadwalnya sedang berlaku — sama persis dengan yang tampil di header."
        />
        <CardBody className="space-y-2">
          {previewItems.length > 0 ? (
            <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
              <MarqueeBar items={previewItems} speedSeconds={Number(marquee?.speedSeconds) || 15} />
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
              Tidak ada isi yang sedang dijadwalkan.
            </p>
          )}

          <p className="text-xs text-slate-500 dark:text-slate-400">
            Bila sistem Anda meminta gerak dikurangi, pratinjau ini memang diam — begitu pula di
            header.
          </p>
        </CardBody>
      </Card>
    </>
  );
}
