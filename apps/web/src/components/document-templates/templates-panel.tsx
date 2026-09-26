'use client';

import { Copy, FileText, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  createDocumentTemplateSchema,
  type DocumentTemplateSummary,
  type DocumentTemplateView,
} from '@dtrace/shared';
import { ApiClientError, clientFetch } from '@/lib/api/client';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/ui/data-table';
import { TextField, TextareaField } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { DateTime } from '@/components/ui/date-time';
import { dynamicRoute } from '@/lib/utils/routes';

export interface TemplatesPanelProps {
  templates: DocumentTemplateSummary[];
  canEdit: boolean;
}

type DialogState =
  | { kind: 'closed' }
  | { kind: 'create' }
  | { kind: 'duplicate'; source: DocumentTemplateSummary }
  | { kind: 'delete'; target: DocumentTemplateSummary };

/**
 * The template list. Creating one only asks for its identity — the sections
 * are designed in the builder, so this dialog stays a doorway rather than a
 * second, smaller version of that screen.
 */
export function TemplatesPanel({ templates, canEdit }: TemplatesPanelProps) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogState>({ kind: 'closed' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', code: '', version: '1.0', description: '' });

  function openCreate() {
    setForm({ name: '', code: '', version: '1.0', description: '' });
    setError(null);
    setDialog({ kind: 'create' });
  }

  function openDuplicate(source: DocumentTemplateSummary) {
    setForm({
      name: `${source.name} (salinan)`,
      code: `${source.code}_COPY`,
      version: source.version,
      description: source.description ?? '',
    });
    setError(null);
    setDialog({ kind: 'duplicate', source });
  }

  async function submit() {
    setBusy(true);
    setError(null);

    try {
      if (dialog.kind === 'create') {
        const parsed = createDocumentTemplateSchema.safeParse({
          name: form.name,
          code: form.code,
          version: form.version,
          description: form.description || null,
          isActive: true,
        });
        if (!parsed.success) {
          setError(parsed.error.issues[0]?.message ?? 'Data belum lengkap');
          return;
        }

        const result = await clientFetch<DocumentTemplateView>('/document-templates', {
          method: 'POST',
          body: parsed.data,
        });
        // Straight into the builder: an empty template is not a destination.
        router.push(dynamicRoute(`/dokumen-template/${result.data.id}`));
        return;
      }

      if (dialog.kind === 'duplicate') {
        const result = await clientFetch<DocumentTemplateView>(
          `/document-templates/${dialog.source.id}/duplicate`,
          { method: 'POST', body: { name: form.name, code: form.code } },
        );
        router.push(dynamicRoute(`/dokumen-template/${result.data.id}`));
        return;
      }

      if (dialog.kind === 'delete') {
        await clientFetch<void>(`/document-templates/${dialog.target.id}`, { method: 'DELETE' });
        setDialog({ kind: 'closed' });
        router.refresh();
      }
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : 'Permintaan gagal.');
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<DocumentTemplateSummary>[] = [
    {
      key: 'name',
      header: 'Template',
      cell: (row) => (
        <Link
          href={dynamicRoute(`/dokumen-template/${row.id}`)}
          className="block hover:underline"
        >
          {/* Link blue, not body ink: this row opens the builder, and a name
              that looks like text gives the reader nothing to aim at. */}
          <span className="font-medium text-sky-700 dark:text-sky-400">{row.name}</span>
          <span className="block text-xs text-slate-500">
            {row.code} · v{row.version}
          </span>
        </Link>
      ),
    },
    {
      key: 'sections',
      header: 'Section',
      cell: (row) => `${row.sectionCount} section`,
      className: 'whitespace-nowrap text-slate-500',
    },
    { key: 'status', header: 'Status', cell: (row) => <StatusBadge active={row.isActive} /> },
    {
      key: 'updatedAt',
      header: 'Diubah',
      cell: (row) => <DateTime value={row.updatedAt} />,
      className: 'whitespace-nowrap text-slate-500',
    },
    ...(canEdit
      ? [
          {
            key: 'actions',
            header: '',
            cell: (row: DocumentTemplateSummary) => (
              <div className="flex justify-end gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Duplikat ${row.name}`}
                  onClick={() => openDuplicate(row)}
                >
                  <Copy className="h-4 w-4" aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Hapus ${row.name}`}
                  onClick={() => {
                    setError(null);
                    setDialog({ kind: 'delete', target: row });
                  }}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            ),
            className: 'text-right',
          } satisfies Column<DocumentTemplateSummary>,
        ]
      : []),
  ];

  const formDialogOpen = dialog.kind === 'create' || dialog.kind === 'duplicate';

  return (
    <>
      <Card>
        <CardHeader
          title="Master Template"
          description={`${templates.length} template dokumen`}
          icon={<FileText className="h-4 w-4" aria-hidden />}
          action={
            canEdit && (
              <Button leftIcon={<Plus className="h-4 w-4" aria-hidden />} onClick={openCreate}>
                Template baru
              </Button>
            )
          }
        />
        <DataTable
          columns={columns}
          rows={templates}
          rowKey={(row) => row.id}
          caption="Daftar master template dokumen"
          emptyMessage="Belum ada template. Buat template pertama untuk mulai menyusun dokumen."
        />
      </Card>

      <Modal
        open={formDialogOpen}
        onClose={() => setDialog({ kind: 'closed' })}
        title={dialog.kind === 'duplicate' ? 'Duplikat template' : 'Template baru'}
        description="Kode dipakai sebagai identitas template dan harus unik."
        footer={
          <>
            <Button variant="outline" onClick={() => setDialog({ kind: 'closed' })}>
              Batal
            </Button>
            <Button loading={busy} onClick={submit}>
              {dialog.kind === 'duplicate' ? 'Duplikat' : 'Buat & susun'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {error && <Alert tone="danger">{error}</Alert>}

          <TextField
            label="Nama template"
            value={form.name}
            maxLength={120}
            placeholder="BPM - Business Process Mapping"
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
          />

          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Kode"
              value={form.code}
              maxLength={20}
              placeholder="BPM"
              onChange={(event) =>
                setForm((current) => ({ ...current, code: event.target.value.toUpperCase() }))
              }
            />
            <TextField
              label="Versi"
              value={form.version}
              maxLength={20}
              placeholder="1.0"
              disabled={dialog.kind === 'duplicate'}
              onChange={(event) =>
                setForm((current) => ({ ...current, version: event.target.value }))
              }
            />
          </div>

          {dialog.kind === 'create' && (
            <TextareaField
              label="Deskripsi"
              value={form.description}
              rows={2}
              maxLength={500}
              onChange={(event) =>
                setForm((current) => ({ ...current, description: event.target.value }))
              }
            />
          )}
        </div>
      </Modal>

      <Modal
        open={dialog.kind === 'delete'}
        onClose={() => setDialog({ kind: 'closed' })}
        size="sm"
        title="Hapus template"
        description={
          dialog.kind === 'delete'
            ? `"${dialog.target.name}" dan seluruh section-nya akan dihapus permanen.`
            : undefined
        }
        footer={
          <>
            <Button variant="outline" onClick={() => setDialog({ kind: 'closed' })}>
              Batal
            </Button>
            <Button variant="destructive" loading={busy} onClick={submit}>
              Hapus
            </Button>
          </>
        }
      >
        {error ? <Alert tone="danger">{error}</Alert> : null}
      </Modal>
    </>
  );
}
