'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Power, Tag, Trash2 } from 'lucide-react';
import type { NodeTypeView } from '@dtrace/shared';
import { ApiClientError, clientFetch } from '@/lib/api/client';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { DropdownMenu } from '@/components/ui/dropdown-menu';
import { PageHeader } from '@/components/ui/page-header';
import { Switch } from '@/components/ui/switch';
import { NodeTypeDialog } from './node-type-dialog';

/**
 * The Jenis Node screen.
 *
 * Server-rendered data seeds the query, so the list is on screen immediately
 * and every later change re-reads from one place instead of each mutation
 * patching local state by hand.
 */
export function NodeTypesManager({ initialTypes }: { initialTypes: NodeTypeView[] }) {
  const queryClient = useQueryClient();
  const [showInactive, setShowInactive] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<NodeTypeView | undefined>();
  const [pendingDelete, setPendingDelete] = useState<NodeTypeView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: types = [] } = useQuery({
    queryKey: ['node-types', { includeInactive: true }],
    queryFn: async () =>
      (await clientFetch<NodeTypeView[]>('/node-types', { searchParams: { includeInactive: 'true' } }))
        .data,
    initialData: initialTypes,
  });

  const toggleActive = useMutation({
    mutationFn: (type: NodeTypeView) =>
      clientFetch<NodeTypeView>(`/node-types/${type.id}`, {
        method: 'PATCH',
        body: {
          name: type.name,
          code: type.code,
          canBeRoot: type.canBeRoot,
          isActive: !type.isActive,
          allowedParentIds: type.allowedParents.map((parent) => parent.id),
        },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['node-types'] }),
    onError: (caught) =>
      setError(caught instanceof ApiClientError ? caught.message : 'Gagal mengubah status.'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => clientFetch<void>(`/node-types/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['node-types'] });
      setPendingDelete(null);
    },
    onError: (caught) => {
      setError(caught instanceof ApiClientError ? caught.message : 'Gagal menghapus jenis.');
      setPendingDelete(null);
    },
  });

  const visible = showInactive ? types : types.filter((type) => type.isActive);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Jenis Node"
        description="Menentukan sebagai apa sebuah node dicatat, dan di mana ia boleh berdiri dalam hierarki."
        actions={
          <Button
            onClick={() => {
              setEditing(undefined);
              setDialogOpen(true);
            }}
            leftIcon={<Plus className="h-4 w-4" aria-hidden />}
          >
            Tambah Jenis
          </Button>
        }
      />

      {error && (
        <Alert tone="danger" className="items-start">
          {error}
        </Alert>
      )}

      <Switch
        checked={showInactive}
        onChange={setShowInactive}
        label="Tampilkan jenis nonaktif"
      />

      {visible.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center gap-3 px-5 py-16 text-center">
            <span className="rounded-full bg-slate-100 p-3 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              <Tag className="h-6 w-6" aria-hidden />
            </span>
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
              Belum ada jenis node
            </p>
            <p className="max-w-sm text-sm text-slate-500 dark:text-slate-400">
              Buat jenis pertama — biasanya jenis akar seperti &ldquo;Main Company&rdquo; — lalu
              susun jenis di bawahnya.
            </p>
          </div>
        </Card>
      ) : (
        <Card className="divide-y divide-slate-200 dark:divide-slate-800">
          {visible.map((type) => (
            <div
              key={type.id}
              className="flex flex-wrap items-start justify-between gap-3 px-5 py-4"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-slate-900 dark:text-slate-100">
                    {type.name}
                  </span>
                  <code className="font-mono text-xs uppercase text-slate-400">{type.code}</code>
                  {type.canBeRoot && <Badge tone="info">Akar</Badge>}
                  {!type.isActive && <Badge>Nonaktif</Badge>}
                  {type.nodeCount > 0 && <Badge>{type.nodeCount} node</Badge>}
                </div>

                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Boleh di bawah:{' '}
                  {type.allowedParents.length > 0
                    ? type.allowedParents.map((parent) => parent.name).join(', ')
                    : 'Hanya akar'}
                </p>
              </div>

              <DropdownMenu
                label={`Aksi untuk ${type.name}`}
                actions={[
                  {
                    label: 'Ubah',
                    icon: <Pencil className="h-4 w-4" aria-hidden />,
                    onSelect: () => {
                      setEditing(type);
                      setDialogOpen(true);
                    },
                  },
                  {
                    label: type.isActive ? 'Nonaktifkan' : 'Aktifkan',
                    icon: <Power className="h-4 w-4" aria-hidden />,
                    onSelect: () => {
                      setError(null);
                      toggleActive.mutate(type);
                    },
                  },
                  {
                    label: 'Hapus',
                    icon: <Trash2 className="h-4 w-4" aria-hidden />,
                    danger: true,
                    // A type in use cannot be deleted; saying so before the
                    // click is kinder than a rejection after it.
                    disabled: type.nodeCount > 0,
                    onSelect: () => {
                      setError(null);
                      setPendingDelete(type);
                    },
                  },
                ]}
              />
            </div>
          ))}
        </Card>
      )}

      <NodeTypeDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        editing={editing}
        allTypes={types}
      />

      <Dialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Hapus jenis node?"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingDelete(null)}>
              Batal
            </Button>
            <Button
              variant="destructive"
              loading={remove.isPending}
              onClick={() => pendingDelete && remove.mutate(pendingDelete.id)}
            >
              Hapus
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          <span className="font-medium text-slate-900 dark:text-slate-100">
            {pendingDelete?.name}
          </span>{' '}
          akan dihapus permanen. Tindakan ini tercatat di Audit Log.
        </p>
      </Dialog>
    </div>
  );
}
