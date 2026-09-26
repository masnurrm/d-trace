'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileText, Paperclip, PenLine, Upload, X } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useRef, useState } from 'react';
import { ApiClientError, clientFetch } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils/cn';

/**
 * Loaded only when somebody actually annotates.
 *
 * Konva, PDF.js and pdf-lib together are a large amount of JavaScript, and a
 * reader who only wants to look at the file should not pay for the editor. It
 * is client-only besides: PDF.js touches `DOMMatrix` at import time, which the
 * server does not have.
 */
const PdfAnnotator = dynamic(
  () => import('./pdf/pdf-annotator').then((module) => module.PdfAnnotator),
  { ssr: false, loading: () => <p className="py-10 text-center text-sm text-slate-500">Menyiapkan editor…</p> },
);

interface StoredFile {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedByName: string | null;
  createdAt: string;
}

const formatSize = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/** Everything the browser fetches goes through the BFF; there is no token here. */
const fileUrl = (id: string, inline: boolean) =>
  `/api/bff/workspace/files/${id}/download${inline ? '?inline=1' : ''}`;

/**
 * The files attached to a document, with PDFs shown rather than downloaded.
 *
 * Only PDFs render inline, and only because the API grants that one type an
 * exception — an uploaded HTML or SVG served inline would run its own script
 * against this origin. Everything else stays a download link, which is not a
 * limitation of this component but the point of it.
 *
 * Reading uses the browser's own PDF viewer in a frame: no dependency, and it
 * prints and searches the way people already expect. Annotating swaps that for
 * a Konva canvas, because an iframe's internals cannot be drawn on from
 * outside it — the editor is loaded only when asked for.
 */
export function DocumentFileViewer({
  documentId,
  emptyHint,
  canUpload = false,
}: {
  documentId: string;
  canUpload?: boolean;
  /** Shown when there are no files. Given only when nothing else on the page
   *  would explain the emptiness — otherwise the card stays out of the way. */
  emptyHint?: string;
}) {
  const { data, isPending } = useQuery({
    queryKey: ['documents', documentId, 'files'],
    queryFn: () => clientFetch<StoredFile[]>(`/workspace/documents/${documentId}/files`),
  });

  const queryClient = useQueryClient();
  const files = data?.data ?? [];
  const previewable = files.filter(
    (file) => file.mimeType === 'application/pdf' || file.mimeType.startsWith('image/'),
  );
  const fileInput = useRef<HTMLInputElement>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [annotating, setAnnotating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const active = previewable.find((file) => file.id === activeId) ?? previewable[0] ?? null;

  async function upload(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    const form = new FormData();
    form.append('file', file);

    try {
      const result = await clientFetch<StoredFile>(`/workspace/documents/${documentId}/files`, {
        method: 'POST',
        body: form,
      });
      setActiveId(result.data.id);
      await queryClient.invalidateQueries({ queryKey: ['documents', documentId, 'files'] });
    } catch (caught) {
      setUploadError(
        caught instanceof ApiClientError ? caught.message : 'Berkas gagal diunggah.',
      );
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  const uploadControl = canUpload && (
    <>
      <Button
        variant="outline"
        size="sm"
        loading={uploading}
        leftIcon={<Upload className="h-4 w-4" aria-hidden />}
        onClick={() => fileInput.current?.click()}
      >
        Lampirkan dokumen
      </Button>
      <input
        ref={fileInput}
        type="file"
        className="hidden"
        accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.png,.jpg,.jpeg,.zip"
        onChange={(event) => void upload(event.target.files?.[0])}
      />
    </>
  );

  if (isPending) {
    return (
      <Card>
        <CardBody className="text-sm text-slate-500">Memuat lampiran…</CardBody>
      </Card>
    );
  }

  if (files.length === 0) {
    if (!emptyHint) return null;

    return (
      <Card>
        <CardHeader
          title="Berkas dokumen"
          icon={<Paperclip className="h-4 w-4" aria-hidden />}
          tinted
        />
        <CardBody className="space-y-3 text-sm text-slate-500">
          <p>{emptyHint}</p>
          {uploadControl}
          {uploadError && <p className="text-red-600">{uploadError}</p>}
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Berkas dokumen"
        description={
          previewable.length > 0
            ? 'PDF dan gambar ditampilkan langsung; berkas lain dapat diunduh.'
            : 'Berkas ini tidak bisa ditampilkan di halaman, jadi diunduh.'
        }
        icon={<Paperclip className="h-4 w-4" aria-hidden />}
        action={uploadControl}
        tinted
      />

      <CardBody className="space-y-4">
        {uploadError && <p className="text-sm text-red-600">{uploadError}</p>}
        <ul className="space-y-1.5">
          {files.map((file) => {
            const canPreview =
              file.mimeType === 'application/pdf' || file.mimeType.startsWith('image/');
            const isActive = active?.id === file.id;

            return (
              <li
                key={file.id}
                className={cn(
                  'flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2',
                  isActive
                    ? 'border-sky-300 bg-sky-50/60'
                    : 'border-slate-200 dark:border-slate-800',
                )}
              >
                <FileText className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-slate-800 dark:text-slate-200">
                    {file.fileName}
                  </span>
                  <span className="block text-xs text-slate-500">
                    {formatSize(file.sizeBytes)}
                    {file.uploadedByName ? ` · ${file.uploadedByName}` : ''}
                  </span>
                </span>

                {canPreview && previewable.length > 1 && (
                  <Button variant="outline" size="sm" onClick={() => setActiveId(file.id)}>
                    {isActive ? 'Ditampilkan' : 'Tampilkan'}
                  </Button>
                )}

                <a href={fileUrl(file.id, false)} download>
                  <Button
                    variant="ghost"
                    size="sm"
                    leftIcon={<Download className="h-4 w-4" aria-hidden />}
                  >
                    Unduh
                  </Button>
                </a>
              </li>
            );
          })}
        </ul>

        {active && !annotating && (
          <>
            {active.mimeType === 'application/pdf' && (
              <div className="flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  leftIcon={<PenLine className="h-4 w-4" aria-hidden />}
                  onClick={() => setAnnotating(true)}
                >
                  Anotasi & tanda tangan
                </Button>
              </div>
            )}
            <iframe
              key={active.id}
              src={fileUrl(active.id, true)}
              title={`Pratinjau ${active.fileName}`}
              className="h-[70vh] w-full rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-800"
            />
          </>
        )}

        {active && annotating && (
          <>
            <div className="flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<X className="h-4 w-4" aria-hidden />}
                onClick={() => setAnnotating(false)}
              >
                Tutup editor
              </Button>
            </div>
            <PdfAnnotator
              documentId={documentId}
              fileId={active.id}
              fileName={active.fileName}
              onSaved={() => {
                setAnnotating(false);
                // The new file has to appear in the list beside the original.
                void queryClient.invalidateQueries({
                  queryKey: ['documents', documentId, 'files'],
                });
              }}
            />
          </>
        )}
      </CardBody>
    </Card>
  );
}
