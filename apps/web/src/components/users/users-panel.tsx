'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { ROLE_LABELS, ROLE_VALUES, type Role, type User } from '@dtrace/shared';
import { ApiClientError, clientFetch, type ClientResult } from '@/lib/api/client';
import { queryKeys } from '@/lib/query/keys';
import { useUrlFilters } from '@/lib/query/use-url-filters';
import { Alert } from '@/components/ui/alert';
import { RoleBadge, StatusBadge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { DataTable, PaginationBar, type Column } from '@/components/ui/data-table';
import { DateTime } from '@/components/ui/date-time';
import { UrlFilterBar } from '@/components/filters/url-filter-bar';
import type { FilterDef } from '@/components/ui/filter-bar';
import { Button } from '@/components/ui/button';
import { DropdownMenu } from '@/components/ui/dropdown-menu';
import { UserAccessDialog } from './user-access-dialog';
import { UserRoleSelect } from './user-role-select';
import { usersSearchString } from './query';
import { cn } from '@/lib/utils/cn';

/** Declared once, outside the component, so its identity never changes. */
const FILTERS: FilterDef[] = [
  { kind: 'text', name: 'search', label: 'Cari', placeholder: 'Nama atau email' },
  {
    kind: 'select',
    name: 'role',
    label: 'Role',
    placeholder: 'Semua role',
    options: ROLE_VALUES.map((value) => ({ value, label: ROLE_LABELS[value] })),
  },
  {
    kind: 'select',
    name: 'isActive',
    label: 'Status',
    placeholder: 'Semua status',
    options: [
      { value: 'true', label: 'Aktif' },
      { value: 'false', label: 'Nonaktif' },
    ],
  },
];

interface UsersPanelProps {
  /** The search string the server rendered with, used to seed the cache. */
  initialSearch: string;
  initialResult: ClientResult<User[]>;
  isAdmin: boolean;
  currentUserId: string | null;
}

/**
 * The users list, fetched by TanStack Query and driven by the URL.
 *
 * Filters and paging rewrite the URL without a router navigation, so changing
 * a page costs one BFF call instead of a full server re-render — and
 * `keepPreviousData` leaves the current rows on screen while the next page
 * loads, which is what makes paging feel instant instead of blanking.
 */
export function UsersPanel({
  initialSearch,
  initialResult,
  isAdmin,
  currentUserId,
}: UsersPanelProps) {
  const { searchParams, setFilters } = useUrlFilters();

  // null while closed; a User while editing, undefined-as-null while creating.
  const [editing, setEditing] = useState<User | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const search = usersSearchString(searchParams);

  const { data, error, isPending, isFetching } = useQuery({
    queryKey: queryKeys.users(search),
    queryFn: () => clientFetch<User[]>(`/users?${search}`),
    placeholderData: keepPreviousData,
    // Only the first render can reuse the server's work; every other filter
    // state is a cache key the server never fetched.
    initialData: search === initialSearch ? initialResult : undefined,
  });

  const columns: Column<User>[] = [
    {
      key: 'name',
      header: 'User',
      cell: (row) => (
        <div>
          <p className="font-medium text-slate-900 dark:text-slate-100">{row.name}</p>
          <p className="text-xs text-slate-500">{row.email}</p>
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      cell: (row) =>
        // Only an admin gets the editable control; everyone else sees a badge.
        isAdmin && row.id !== currentUserId ? (
          <UserRoleSelect userId={row.id} role={row.role as Role} />
        ) : (
          <RoleBadge role={row.role} />
        ),
    },
    { key: 'status', header: 'Status', cell: (row) => <StatusBadge active={row.isActive} /> },
    {
      key: 'lastLogin',
      header: 'Terakhir masuk',
      cell: (row) => <DateTime value={row.lastLoginAt} relative fallback="Belum pernah" />,
      className: 'whitespace-nowrap text-slate-500',
    },
    {
      key: 'createdAt',
      header: 'Dibuat',
      cell: (row) => <DateTime value={row.createdAt} />,
      className: 'whitespace-nowrap text-slate-500',
    },
  ];

  if (isAdmin) {
    columns.push({
      key: 'actions',
      header: 'Aksi',
      className: 'w-16 text-right',
      cell: (row) => (
        <div className="flex justify-end">
          <DropdownMenu
            label={`Aksi untuk ${row.name}`}
            actions={[
              {
                label: 'Ubah User & Akses',
                icon: <Pencil className="h-4 w-4" aria-hidden />,
                onSelect: () => {
                  setEditing(row);
                  setDialogOpen(true);
                },
              },
            ]}
          />
        </div>
      ),
    });
  }

  const meta = data?.meta;

  return (
    <Card>
      <CardHeader
        title="Daftar User"
        description={`${meta?.total ?? 0} akun`}
        action={
          isAdmin ? (
            <Button
              size="sm"
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
              leftIcon={<Plus className="h-4 w-4" aria-hidden />}
            >
              Tambah
            </Button>
          ) : undefined
        }
      />

      <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
        <UrlFilterBar filters={FILTERS} isPending={isFetching} collapsible />
      </div>

      {error && (
        <div className="px-5 pt-4">
          <Alert tone="danger">
            {error instanceof ApiClientError ? error.message : 'Daftar user gagal dimuat.'}
          </Alert>
        </div>
      )}

      {/* Dimmed while refetching: the rows on screen are the previous page. */}
      <div className={cn('transition-opacity', isFetching && !isPending && 'opacity-60')}>
        <DataTable
          columns={columns}
          rows={data?.data ?? []}
          rowKey={(row) => row.id}
          caption="Daftar user"
          isLoading={isPending}
          emptyMessage="Tidak ada user yang cocok dengan filter ini."
        />
      </div>

      {meta && (
        <PaginationBar
          meta={meta}
          onPageChange={(page) => setFilters((params) => params.set('page', String(page)))}
          onPageSizeChange={(size) =>
            setFilters((params) => {
              params.set('limit', String(size));
              // A new page size makes the old page number meaningless.
              params.delete('page');
            })
          }
        />
      )}
      <UserAccessDialog
        user={editing}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
      />
    </Card>
  );
}
