'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createNodeTypeSchema, type NodeTypeView } from '@dtrace/shared';
import { ApiClientError, clientFetch } from '@/lib/api/client';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { TextField } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';

interface NodeTypeDialogProps {
  open: boolean;
  onClose: () => void;
  /** Absent when creating. */
  editing?: NodeTypeView;
  /** Every type, so the operator can pick which may stand above this one. */
  allTypes: NodeTypeView[];
}

interface FormState {
  name: string;
  code: string;
  canBeRoot: boolean;
  isActive: boolean;
  allowedParentIds: string[];
}

const EMPTY: FormState = {
  name: '',
  code: '',
  canBeRoot: false,
  isActive: true,
  allowedParentIds: [],
};

/**
 * Create or edit a node type.
 *
 * The placement rules are the point of this form, so they are shown as plain
 * checkboxes of real types rather than hidden behind a multi-select: an
 * operator deciding "where may a Department sit" should see every option and
 * which ones are ticked without opening anything.
 */
export function NodeTypeDialog({ open, onClose, editing, allTypes }: NodeTypeDialogProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  // Re-seed whenever the dialog opens, so editing one type never shows the
  // leftovers of the last one.
  useEffect(() => {
    if (!open) return;
    setErrors({});
    setFormError(null);
    setForm(
      editing
        ? {
            name: editing.name,
            code: editing.code,
            canBeRoot: editing.canBeRoot,
            isActive: editing.isActive,
            allowedParentIds: editing.allowedParents.map((parent) => parent.id),
          }
        : EMPTY,
    );
  }, [open, editing]);

  const save = useMutation({
    mutationFn: (values: FormState) =>
      editing
        ? clientFetch<NodeTypeView>(`/node-types/${editing.id}`, { method: 'PATCH', body: values })
        : clientFetch<NodeTypeView>('/node-types', { method: 'POST', body: values }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['node-types'] });
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

  function submit() {
    setFormError(null);
    setErrors({});

    // The shared schema is the authority here too: the same rules the API
    // enforces, run before the round trip so mistakes surface immediately.
    const parsed = createNodeTypeSchema.safeParse(form);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        next[issue.path.join('.') || 'form'] = issue.message;
      }
      setErrors(next);
      setFormError(next['form'] ?? null);
      return;
    }

    save.mutate(parsed.data as unknown as FormState);
  }

  // A type cannot be offered as its own parent from this form.
  const parentOptions = allTypes.filter((type) => type.id !== editing?.id);

  function toggleParent(id: string) {
    setForm((current) => ({
      ...current,
      allowedParentIds: current.allowedParentIds.includes(id)
        ? current.allowedParentIds.filter((value) => value !== id)
        : [...current.allowedParentIds, id],
    }));
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? `Ubah ${editing.name}` : 'Tambah Jenis Node'}
      description="Jenis menentukan sebagai apa node dicatat, dan di mana ia boleh berdiri."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
            Batal
          </Button>
          <Button onClick={submit} loading={save.isPending}>
            Simpan
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {formError && <Alert tone="danger">{formError}</Alert>}

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Nama"
            name="node-type-name"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            error={errors['name']}
          />
          <TextField
            label="Kode"
            name="node-type-code"
            value={form.code}
            placeholder="MAIN_COMPANY"
            hint="Huruf kapital, angka, dan garis bawah."
            onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })}
            error={errors['code']}
          />
        </div>

        <Switch
          checked={form.canBeRoot}
          onChange={(checked) => setForm({ ...form, canBeRoot: checked })}
          label="Boleh berdiri sebagai akar"
          description="Node jenis ini bisa diletakkan di tingkat paling atas hierarki."
        />

        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Boleh di bawah</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Pilih jenis yang boleh menjadi induk langsung. Kosongkan bila jenis ini hanya berdiri di
            akar.
          </p>

          {parentOptions.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
              Belum ada jenis lain. Jenis pertama biasanya dibuat sebagai akar.
            </p>
          ) : (
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2 dark:border-slate-700">
              {parentOptions.map((type) => (
                <label
                  key={type.id}
                  className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <input
                    type="checkbox"
                    checked={form.allowedParentIds.includes(type.id)}
                    onChange={() => toggleParent(type.id)}
                    className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                  />
                  <span className="flex-1">{type.name}</span>
                  <code className="font-mono text-xs text-slate-400">{type.code}</code>
                </label>
              ))}
            </div>
          )}

          {errors['allowedParentIds'] && (
            <p role="alert" className="text-xs font-medium text-red-600 dark:text-red-400">
              {errors['allowedParentIds']}
            </p>
          )}
        </div>

        <Switch
          checked={form.isActive}
          onChange={(checked) => setForm({ ...form, isActive: checked })}
          label="Aktif"
          description="Jenis nonaktif tidak bisa dipilih saat membuat node baru."
        />
      </div>
    </Dialog>
  );
}
