'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import {
  HOLIDAY_SOURCE_LABELS,
  type HolidaySyncResult,
  type HolidayView,
} from '@dtrace/shared';
import { ApiClientError, clientFetch } from '@/lib/api/client';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/data-table';
import { SelectControl, TextField } from '@/components/ui/field';
import { cn } from '@/lib/utils/cn';

const WEEKDAY = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

/** A window wide enough to plan against, narrow enough to stay a dropdown. */
const YEARS = Array.from({ length: 7 }, (_, index) => new Date().getFullYear() - 1 + index);

const formatDate = (key: string) => {
  const date = new Date(`${key}T00:00:00`);
  return `${WEEKDAY[date.getDay()]}, ${date.toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })}`;
};

/**
 * The non-working calendar the project timeline schedules around.
 *
 * Weekends are a rule and live in code. Public holidays are data: they differ
 * by country and move every year, so they are imported from a public calendar
 * and then editable by hand. A sync replaces only what it imported — a date
 * somebody added here on purpose survives it.
 */
export function HolidaysPanel({ initialYear }: { initialYear: number }) {
  const queryClient = useQueryClient();
  const [year, setYear] = useState(initialYear);
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const key = ['holidays', year];

  const { data, isPending } = useQuery({
    queryKey: key,
    queryFn: () => clientFetch<HolidayView[]>(`/holidays?year=${year}&countryCode=ID`),
  });

  const holidays = data?.data ?? [];

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['holidays'] });

  const sync = useMutation({
    mutationFn: () =>
      clientFetch<HolidaySyncResult>('/holidays/sync', {
        method: 'POST',
        body: { year, countryCode: 'ID' },
      }),
    onSuccess: (result) => {
      setNotice(
        `${result.data.imported} hari libur ${result.data.year} diambil dari kalender publik` +
          (result.data.keptManual > 0
            ? `, ${result.data.keptManual} entri manual dipertahankan.`
            : '.'),
      );
      void refresh();
    },
  });

  const add = useMutation({
    mutationFn: () =>
      clientFetch<HolidayView>('/holidays', {
        method: 'POST',
        body: { date, name: name.trim(), countryCode: 'ID' },
      }),
    onSuccess: () => {
      setDate('');
      setName('');
      setNotice(null);
      void refresh();
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => clientFetch(`/holidays/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setNotice(null);
      void refresh();
    },
  });

  const failure = sync.error ?? add.error ?? remove.error;
  const error =
    failure instanceof ApiClientError
      ? failure.message
      : failure
        ? 'Permintaan gagal. Coba lagi.'
        : null;

  const columns: Column<HolidayView>[] = [
    {
      key: 'date',
      header: 'Tanggal',
      cell: (row) => <span className="whitespace-nowrap">{formatDate(row.date)}</span>,
    },
    { key: 'name', header: 'Keterangan', cell: (row) => row.name },
    {
      key: 'source',
      header: 'Sumber',
      cell: (row) => (
        <Badge tone={row.source === 'MANUAL' ? 'info' : 'neutral'}>
          {HOLIDAY_SOURCE_LABELS[row.source]}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      cell: (row) => (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Hapus ${row.name}`}
          loading={remove.isPending}
          onClick={() => remove.mutate(row.id)}
        >
          <Trash2 className="h-3.5 w-3.5 text-red-500" aria-hidden />
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {error && <Alert tone="danger">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      <Card>
        <CardHeader
          title="Hari Libur Nasional"
          description="Dipakai timeline project untuk melewati hari yang tidak dikerjakan."
          icon={<CalendarDays className="h-4 w-4" aria-hidden />}
          tinted
          action={
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-32">
                <span className="mb-1.5 block text-sm font-medium text-slate-700">Tahun</span>
                <SelectControl
                  aria-label="Tahun"
                  value={String(year)}
                  onValueChange={(value) => value && setYear(Number(value))}
                  options={YEARS.map((value) => ({ value: String(value), label: String(value) }))}
                />
              </div>
              <Button
                variant="outline"
                leftIcon={<RefreshCw className="h-4 w-4" aria-hidden />}
                loading={sync.isPending}
                onClick={() => sync.mutate()}
              >
                Sync kalender publik
              </Button>
            </div>
          }
        />

        <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <TextField
            label="Tanggal"
            type="date"
            name="holiday-date"
            className="w-44"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
          <TextField
            label="Keterangan"
            name="holiday-name"
            className="w-72"
            maxLength={120}
            placeholder="Cuti bersama, libur perusahaan…"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <Button
            leftIcon={<Plus className="h-4 w-4" aria-hidden />}
            loading={add.isPending}
            disabled={!date || name.trim().length < 2}
            onClick={() => add.mutate()}
          >
            Tambah
          </Button>

          <p className={cn('ml-auto pb-2 text-sm text-slate-500')}>
            {holidays.length} hari libur di {year}
          </p>
        </div>

        <DataTable
          columns={columns}
          rows={holidays}
          rowKey={(row) => row.id}
          isLoading={isPending}
          caption={`Hari libur ${year}`}
          emptyMessage={`Belum ada hari libur ${year}. Jalankan sync untuk mengambilnya dari kalender publik.`}
        />
      </Card>
    </div>
  );
}
