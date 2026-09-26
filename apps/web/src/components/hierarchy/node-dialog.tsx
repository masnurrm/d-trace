'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { NodeTypeView, NodeView } from '@dtrace/shared';
import { ApiClientError, clientFetch } from '@/lib/api/client';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { SelectField, TextField } from '@/components/ui/field';

export type NodeDialogMode =
  | { kind: 'create'; parent: NodeView | null }
  | { kind: 'edit'; node: NodeView };

interface NodeDialogProps {
  mode: NodeDialogMode | null;
  onClose: () => void;
  types: NodeTypeView[];
  /** Used to name the parent and to work out which types may go there. */
  nodes: NodeView[];
}

/**
 * Create a node, or rename one and change its type.
 *
 * The type list is filtered to what the target position actually allows, so the
 * operator is offered only placements the API will accept — the rules are
 * enforced server-side either way, but a menu of options that all fail is a
 * poor way to learn them.
 */
export function NodeDialog({ mode, onClose, types, nodes }: NodeDialogProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [typeId, setTypeId] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const editing = mode?.kind === 'edit' ? mode.node : null;
  const parent = mode?.kind === 'create' ? mode.parent : null;

  useEffect(() => {
    if (!mode) return;
    setErrors({});
    setFormError(null);

    if (mode.kind === 'edit') {
      setName(mode.node.name);
      setCode(mode.node.code);
      setTypeId(mode.node.type.id);
    } else {
      setName('');
      setCode('');
      setTypeId('');
    }
  }, [mode]);

  // Which types may stand in this position?
  const parentNode = editing
    ? nodes.find((node) => node.id === editing.parentId) ?? null
    : parent;
  const parentTypeId = parentNode?.type.id ?? null;

  const allowedTypes = types.filter((type) => {
    if (!type.isActive) return false;
    return parentTypeId === null
      ? type.canBeRoot
      : type.allowedParents.some((allowed) => allowed.id === parentTypeId);
  });

  const save = useMutation({
    mutationFn: () =>
      editing
        ? clientFetch<NodeView>(`/nodes/${editing.id}`, {
            method: 'PATCH',
            body: { name, code, typeId },
          })
        : clientFetch<NodeView>('/nodes', {
            method: 'POST',
            body: { name, code, typeId, parentId: parent?.id ?? null },
          }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['nodes'] });
      onClose();
    },
    onError: (error) => {
      if (error instanceof ApiClientError) {
        const fieldErrors = error.fieldErrors;
        setErrors(fieldErrors);
        setFormError(Object.keys(fieldErrors).length > 0 ? null : error.message);
        return;
      }
      setFormError('Gagal menyimpan. Coba lagi.');
    },
  });

  const title = editing
    ? `Ubah ${editing.name}`
    : parent
      ? `Tambah anak di bawah ${parent.name}`
      : 'Tambah Node Akar';

  return (
    <Dialog
      open={mode !== null}
      onClose={onClose}
      title={title}
      description={
        parentNode
          ? `Akan diletakkan di bawah ${parentNode.name} (${parentNode.type.name}).`
          : 'Akan berdiri di tingkat paling atas hierarki.'
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
            Batal
          </Button>
          <Button
            onClick={() => save.mutate()}
            loading={save.isPending}
            disabled={allowedTypes.length === 0}
          >
            Simpan
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {formError && <Alert tone="danger">{formError}</Alert>}

        {allowedTypes.length === 0 && (
          <Alert tone="warning" title="Belum ada jenis yang cocok">
            {parentNode
              ? `Tidak ada jenis node aktif yang boleh berada di bawah ${parentNode.type.name}. Atur dulu di menu Jenis Node.`
              : 'Tidak ada jenis node aktif yang boleh berdiri sebagai akar. Atur dulu di menu Jenis Node.'}
          </Alert>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Nama"
            name="node-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            error={errors['name']}
          />
          <TextField
            label="Kode"
            name="node-code"
            value={code}
            placeholder="AGIT"
            hint="Huruf kapital, angka, dan garis bawah."
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            error={errors['code']}
          />
        </div>

        <SelectField
          label="Jenis node"
          name="node-type"
          value={typeId}
          placeholder="Pilih jenis…"
          onValueChange={(value) => setTypeId(value)}
          options={allowedTypes.map((type) => ({ value: type.id, label: type.name }))}
          hint={
            editing
              ? 'Mengubah jenis hanya bisa ke jenis yang tetap sah di posisi ini.'
              : undefined
          }
          error={errors['typeId']}
        />
      </div>
    </Dialog>
  );
}
