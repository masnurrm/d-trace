'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { collectDescendantIds, type NodeTypeView, type NodeView } from '@dtrace/shared';
import { ApiClientError, clientFetch } from '@/lib/api/client';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { SelectField } from '@/components/ui/field';

interface MoveNodeDialogProps {
  node: NodeView | null;
  onClose: () => void;
  nodes: NodeView[];
  types: NodeTypeView[];
}

/**
 * Re-parents a node together with everything under it.
 *
 * The destination list is filtered three ways before it is shown: the node's
 * own subtree is excluded (moving into it would detach the branch), its current
 * parent is excluded (that is not a move), and only parents whose type the
 * node's type permits are offered.
 */
export function MoveNodeDialog({ node, onClose, nodes, types }: MoveNodeDialogProps) {
  const queryClient = useQueryClient();
  const [parentId, setParentId] = useState<string>('');

  useEffect(() => {
    if (node) setParentId('');
  }, [node]);

  const move = useMutation({
    mutationFn: () =>
      clientFetch<NodeView>(`/nodes/${node!.id}/move`, {
        method: 'PATCH',
        body: { parentId: parentId === '__root__' ? null : parentId },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['nodes'] });
      onClose();
    },
  });

  if (!node) {
    return <Dialog open={false} onClose={onClose} title="Pindahkan node" children={null} />;
  }

  const nodeType = types.find((type) => type.id === node.type.id);
  const allowedParentTypeIds = new Set(nodeType?.allowedParents.map((parent) => parent.id) ?? []);
  const excluded = new Set([node.id, ...collectDescendantIds(nodes, node.id)]);

  const candidates = nodes.filter(
    (candidate) =>
      !excluded.has(candidate.id) &&
      candidate.id !== node.parentId &&
      candidate.isActive &&
      allowedParentTypeIds.has(candidate.type.id),
  );

  const options = [
    ...(nodeType?.canBeRoot && node.parentId !== null
      ? [{ value: '__root__', label: 'Akar (tanpa induk)' }]
      : []),
    ...candidates.map((candidate) => ({
      value: candidate.id,
      label: `${'— '.repeat(candidate.depth)}${candidate.name} (${candidate.type.name})`,
    })),
  ];

  const error = move.error;

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Pindahkan ${node.name}`}
      description="Seluruh cabang di bawahnya ikut berpindah."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={move.isPending}>
            Batal
          </Button>
          <Button onClick={() => move.mutate()} loading={move.isPending} disabled={!parentId}>
            Pindahkan
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <Alert tone="danger">
            {error instanceof ApiClientError ? error.message : 'Gagal memindahkan node.'}
          </Alert>
        )}

        {options.length === 0 ? (
          <Alert tone="warning" title="Tidak ada tujuan yang sah">
            Jenis <strong>{node.type.name}</strong> hanya boleh berada di bawah{' '}
            {nodeType?.allowedParents.map((parent) => parent.name).join(', ') || '—'}, dan saat ini
            tidak ada node aktif berjenis itu di luar cabang ini.
          </Alert>
        ) : (
          <SelectField
            label="Induk baru"
            name="move-parent"
            value={parentId}
            placeholder="Pilih tujuan…"
            onValueChange={(value) => setParentId(value)}
            options={options}
            hint="Hanya menampilkan tujuan yang diizinkan aturan jenis node."
          />
        )}
      </div>
    </Dialog>
  );
}
