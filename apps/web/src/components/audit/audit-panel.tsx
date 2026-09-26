'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Eye, ScrollText, Table2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  AUDIT_ACTION_VALUES,
  AUDIT_ENTITY_VALUES,
  type AuditLog,
  type User,
} from '@dtrace/shared';
import { ApiClientError, clientFetch, type ClientResult } from '@/lib/api/client';
import { queryKeys } from '@/lib/query/keys';
import { useUrlFilters } from '@/lib/query/use-url-filters';
import { UrlFilterBar } from '@/components/filters/url-filter-bar';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { DataTable, PaginationBar, type Column } from '@/components/ui/data-table';
import type { FilterDef } from '@/components/ui/filter-bar';
import { formatDateTime } from '@/lib/utils/format';
import { useLocalTimeZone } from '@/lib/utils/use-local-time-zone';
import { DateTime } from '@/components/ui/date-time';
import { cn } from '@/lib/utils/cn';
import { AuditDetailDialog } from './audit-detail-dialog';
import { auditSearchString } from './query';
import { describeAction } from './action-label';

interface AuditPanelProps {
  initialSearch: string;
  initialResult: ClientResult<AuditLog[]>;
}

/** Same query-driven pattern as `UsersPanel`; see that file for the reasoning. */
export function AuditPanel({ initialSearch, initialResult }: AuditPanelProps) {
  // The row label is a string, so it cannot use <DateTime>; it reads the same
  // zone directly so the label and the cell beside it never disagree.
  const timeZone = useLocalTimeZone();
  const { searchParams, setFilters } = useUrlFilters();
  const search = auditSearchString(searchParams);
  const [detail, setDetail] = useState<AuditLog | null>(null);

  const { data, error, isPending, isFetching } = useQuery({
    queryKey: queryKeys.auditLogs(search),
    queryFn: () => clientFetch<AuditLog[]>(`/audit-logs?${search}`),
    placeholderData: keepPreviousData,
    initialData: search === initialSearch ? initialResult : undefined,
  });

  // The actor dropdown needs names, and so do the rows: the trail stores an
  // email, not a display name. Anyone allowed to read the audit log is also
  // allowed to list users, so this cannot 403 on its own.
  const { data: users } = useQuery({
    queryKey: ['users', 'options'],
    queryFn: () => clientFetch<User[]>('/users?limit=100'),
    staleTime: 5 * 60_000,
  });

  const actors = useMemo(
    () => [...(users?.data ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [users],
  );

  const actorNames = useMemo(() => new Map(actors.map((user) => [user.id, user.name])), [actors]);

  const filters = useMemo<FilterDef[]>(
    () => [
      {
        kind: 'select',
        name: 'actorId',
        label: 'Aktor',
        placeholder: 'Semua aktor',
        options: actors.map((user) => ({ value: user.id, label: `${user.name} · ${user.email}` })),
      },
      {
        kind: 'select',
        name: 'action',
        label: 'Aksi',
        placeholder: 'Semua aksi',
        options: AUDIT_ACTION_VALUES.map((value) => ({
          value,
          label: `${describeAction(value).label} · ${value}`,
        })),
      },
      {
        kind: 'select',
        name: 'entity',
        label: 'Entity',
        placeholder: 'Semua entity',
        options: AUDIT_ENTITY_VALUES.map((value) => ({ value, label: value })),
      },
      { kind: 'date', name: 'from', label: 'Dari tanggal' },
      { kind: 'date', name: 'to', label: 'Sampai tanggal' },
    ],
    [actors],
  );

  const columns = useMemo<Column<AuditLog>[]>(
    () => [
      {
        key: 'when',
        header: 'Waktu',
        sortKey: 'createdAt',
        // Absolute, not "2 hours ago": an audit record is evidence, and
        // evidence needs a timestamp that does not depend on when you read it.
        cell: (row) => <DateTime value={row.createdAt} />,
        className: 'whitespace-nowrap',
      },
      {
        key: 'actor',
        header: 'Aktor',
        cell: (row) => {
          if (!row.actorEmail) return <span className="italic text-slate-500">Sistem</span>;

          const name = row.actorId ? actorNames.get(row.actorId) : undefined;
          if (!name) return row.actorEmail;

          return (
            <div>
              <p className="font-medium text-slate-900 dark:text-slate-100">{name}</p>
              <p className="text-xs text-slate-500">{row.actorEmail}</p>
            </div>
          );
        },
      },
      {
        key: 'action',
        header: 'Aksi',
        sortKey: 'action',
        cell: (row) => {
          const action = describeAction(row.action);
          // The raw code stays reachable on hover, and in the detail dialog.
          return (
            <span title={row.action}>
              <Badge tone={action.tone}>{action.label}</Badge>
            </span>
          );
        },
      },
      { key: 'entity', header: 'Entity', sortKey: 'entity', cell: (row) => row.entity ?? '—' },
      {
        key: 'entityId',
        header: 'ID entity',
        cell: (row) =>
          row.entityId ? (
            <code className="font-mono text-xs text-slate-500" title={row.entityId}>
              {row.entityId.slice(0, 8)}
            </code>
          ) : (
            '—'
          ),
      },
      {
        key: 'ip',
        header: 'IP',
        cell: (row) => <code className="font-mono text-xs text-slate-500">{row.ip ?? '—'}</code>,
      },
      {
        key: 'detail',
        // Not "Aksi": that header is already taken two columns to the left, and
        // two columns with one name is a table no screen reader can explain.
        header: 'Detail',
        headerClassName: 'text-right',
        className: 'text-right',
        cell: (row) => (
          <button
            type="button"
            onClick={() => setDetail(row)}
            aria-label={`Lihat detail kejadian ${formatDateTime(row.createdAt, timeZone)}`}
            className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <Eye className="h-4 w-4" aria-hidden />
          </button>
        ),
      },
    ],
    // `timeZone` is here because the label above reads it: it is undefined
    // until hydration, and a memo that ignored it would keep the UTC label
    // under a cell that now says local time.
    [actorNames, timeZone],
  );

  const meta = data?.meta;
  const sortBy = searchParams.get('sortBy') ?? 'createdAt';
  const sortOrder = searchParams.get('sortOrder') === 'asc' ? 'asc' : 'desc';

  /** Clicking the active column flips direction; a new column starts newest-first. */
  function toggleSort(key: string) {
    setFilters((params) => {
      params.set('sortBy', key);
      params.set('sortOrder', key === sortBy && sortOrder === 'desc' ? 'asc' : 'desc');
      params.delete('page');
    });
  }

  return (
    <div className="space-y-6">
      {/*
        The filters are their own card, above the table rather than inside it.
        Collapsed, they shrink to a single header row, which is the point: an
        operator reading the trail gets the screen back.
      */}
      <UrlFilterBar
        filters={filters}
        isPending={isFetching}
        collapsible
        title="Audit Log"
        description="Setiap perubahan yang tercatat, terbaru lebih dulu."
        icon={<ScrollText className="h-5 w-5" aria-hidden />}
      />

      <Card>
        <CardHeader
          title="Tabel jejak audit"
          icon={<Table2 className="h-5 w-5" aria-hidden />}
          tinted
        />

        {error && (
          <div className="px-5 pt-4">
            <Alert tone="danger">
              {error instanceof ApiClientError ? error.message : 'Audit log gagal dimuat.'}
            </Alert>
          </div>
        )}

        <div className={cn('transition-opacity', isFetching && !isPending && 'opacity-60')}>
          <DataTable
            columns={columns}
            rows={data?.data ?? []}
            rowKey={(row) => row.id}
            caption="Audit log"
            isLoading={isPending}
            sortBy={sortBy}
            sortOrder={sortOrder}
            onSort={toggleSort}
            emptyMessage="Tidak ada kejadian yang cocok dengan filter ini."
          />
        </div>

        {meta && (
          <PaginationBar
            meta={meta}
            onPageChange={(page) => setFilters((params) => params.set('page', String(page)))}
            onPageSizeChange={(size) =>
              setFilters((params) => {
                params.set('limit', String(size));
                params.delete('page');
              })
            }
          />
        )}
      </Card>

      <AuditDetailDialog log={detail} onClose={() => setDetail(null)} />
    </div>
  );
}
