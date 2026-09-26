'use client';

import { Paperclip } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  PROJECT_STAGES,
  PROJECT_STAGE_LABELS,
  type ProjectStage,
  type WorkspaceDocumentSummary,
  type WorkspaceProjectSummary,
} from '@dtrace/shared';
import { ApiClientError, clientFetch } from '@/lib/api/client';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { SelectField, TextField } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';

/** Mirrors the API's allow-list, so the picker offers what the server accepts. */
const ACCEPT =
  '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.png,.jpg,.jpeg,.zip';

/** Kept in step with UPLOAD_MAX_BYTES; the API refuses anything larger anyway. */
const MAX_BYTES = 15 * 1024 * 1024;

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export interface UploadDocumentDialogProps {
  project: WorkspaceProjectSummary | null;
  defaultStage?: ProjectStage;
  onClose: () => void;
}

/**
 * Upload Document: a document whose content is a file someone already has.
 *
 * It creates the document first and attaches the file second, on purpose. The
 * two are separate facts — a document is the thing the project tracks, the
 * file is one rendition of it — and keeping them separate is what later lets a
 * revised file be uploaded without the document losing its identity, its
 * comments or its place in a stage.
 */
export function UploadDocumentDialog({
  project,
  defaultStage = 'PREPARE',
  onClose,
}: UploadDocumentDialogProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [titleTouched, setTitleTouched] = useState(false);
  const [stage, setStage] = useState<ProjectStage>(defaultStage);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (project) {
      setFile(null);
      setTitle('');
      setTitleTouched(false);
      setStage(defaultStage);
      setError(null);
    }
  }, [project, defaultStage]);

  function pick(next: File | null) {
    setError(null);
    setFile(next);
    // The filename is almost always the title someone wants, so it is offered
    // as one — minus the extension, which is the file's business, not the
    // document's.
    if (next && !titleTouched) {
      setTitle(next.name.replace(/\.[^.]+$/, '').slice(0, 160));
    }
  }

  async function submit() {
    if (!project || !file) return;

    if (file.size > MAX_BYTES) {
      setError(`Berkas melebihi batas ${humanSize(MAX_BYTES)}.`);
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const created = await clientFetch<WorkspaceDocumentSummary>('/workspace/documents', {
        method: 'POST',
        body: { projectId: project.id, title: title.trim(), templateId: null, stage },
      });

      const form = new FormData();
      form.append('file', file);

      await clientFetch<unknown>(`/workspace/documents/${created.data.id}/files`, {
        method: 'POST',
        body: form,
      });

      onClose();
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : 'Berkas gagal diunggah.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={project !== null}
      onClose={onClose}
      title="Upload dokumen"
      description={
        project ? `Berkas diunggah sebagai dokumen baru di ${project.name}.` : undefined
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Batal
          </Button>
          <Button loading={busy} disabled={!file || title.trim().length < 3} onClick={submit}>
            Upload
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <Alert tone="danger">{error}</Alert>}

        <div>
          <p className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
            Berkas
          </p>

          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="sr-only"
            onChange={(event) => pick(event.target.files?.[0] ?? null)}
          />

          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex w-full items-center gap-3 rounded-lg border border-dashed border-slate-300 px-4 py-6 text-left transition-colors hover:border-sky-400 hover:bg-sky-50/50 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            <Paperclip className="h-5 w-5 shrink-0 text-slate-400" aria-hidden />
            {file ? (
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                  {file.name}
                </span>
                <span className="block text-xs text-slate-500">{humanSize(file.size)}</span>
              </span>
            ) : (
              <span className="text-sm text-slate-500">
                Pilih berkas — PDF, Word, Excel, PowerPoint, gambar, atau ZIP.
                Maksimal {humanSize(MAX_BYTES)}.
              </span>
            )}
          </button>
        </div>

        <TextField
          label="Judul dokumen"
          value={title}
          maxLength={160}
          placeholder="Kick Off Meeting Minutes"
          onChange={(event) => {
            setTitleTouched(true);
            setTitle(event.target.value);
          }}
        />

        <SelectField
          label="Tahapan"
          value={stage}
          options={PROJECT_STAGES.map((value) => ({
            value,
            label: PROJECT_STAGE_LABELS[value],
          }))}
          onValueChange={(value) => setStage(value as ProjectStage)}
        />
      </div>
    </Modal>
  );
}
