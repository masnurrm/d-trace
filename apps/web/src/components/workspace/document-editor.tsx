'use client';

import { Eye, FileDown, History, RotateCcw, Save } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Fragment, useCallback, useEffect, useState } from 'react';
import {
  DOCUMENT_STATUSES,
  DOCUMENT_STATUS_LABELS,
  emptyContentFor,
  withDocumentDefaults,
  type DocumentContent,
  type DocumentDetail,
  type DocumentStatus,
  type DocumentVersionDetail,
  type DocumentVersionSummary,
} from '@dtrace/shared';
import { ApiClientError, clientFetch } from '@/lib/api/client';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { SelectField, TextField } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { DateTime } from '@/components/ui/date-time';
import { cn } from '@/lib/utils/cn';
import { SectionAttachments } from '@/components/document-templates/section-attachments';
import { SectionField } from './document-fields';
import { DocumentFillProvider } from './document-fill';
import { DocumentFileViewer } from './document-file-viewer';

const STATUS_TONES: Record<DocumentStatus, 'neutral' | 'info' | 'warning' | 'success'> = {
  DRAFT: 'neutral',
  ON_PROGRESS: 'info',
  REVIEW: 'warning',
  FINAL: 'success',
};

const DOCUMENT_TEMPLATE_DOWNLOADS: Record<string, { fileName: string; url: string }> = {
  'Business Blueprint': {
    fileName: 'Template_Business_Blueprint_Panduan.docx',
    url: '/templates/Template_Business_Blueprint_Panduan.docx',
  },
  'Berita Acara Serah Terima (BAST)': {
    fileName: 'Template_Berita_Acara_Serah_Terima_BAST.docx',
    url: '/templates/Template_Berita_Acara_Serah_Terima_BAST.docx',
  },
};

export interface DocumentEditorProps {
  document: DocumentDetail;
}

/**
 * Filling a document in.
 *
 * The draft lives in local state and one save writes one version. Autosaving
 * would be kinder to a lost tab but would fill the history with a hundred
 * entries nobody decided on — and the history is the reason this screen exists
 * at all. The moment an author chooses to save is the moment worth recording.
 */
export function DocumentEditor({ document }: DocumentEditorProps) {
  const router = useRouter();
  const sections = document.template?.sections ?? [];

  // Bound suggestions (company, application, lead) and live DATA tables start
  // filled in; see `withDocumentDefaults`. Not dirty: nothing was typed yet.
  const withDefaults = (detail: DocumentDetail) =>
    withDocumentDefaults(
      detail.template?.sections ?? [],
      detail.content,
      detail.context,
      detail.projectData,
    );

  const [content, setContent] = useState<DocumentContent>(() => withDefaults(document));
  const [status, setStatus] = useState<DocumentStatus>(document.status);
  const [note, setNote] = useState('');
  const [baseUpdatedAt, setBaseUpdatedAt] = useState(document.updatedAt);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedVersion, setSavedVersion] = useState<number | null>(null);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [versions, setVersions] = useState<DocumentVersionSummary[] | null>(null);
  const [preview, setPreview] = useState<DocumentVersionDetail | null>(null);

  const canEdit = document.capabilities.edit;
  const templateDownload = DOCUMENT_TEMPLATE_DOWNLOADS[document.title];
  // A version being previewed is history: it is shown, never typed into.
  const readOnly = !canEdit || preview !== null;

  const sectionTitle = useCallback(
    (key: string) => sections.find((section) => section.key === key)?.title ?? key,
    [sections],
  );

  function update(key: string, value: unknown) {
    setDirty(true);
    setSavedVersion(null);
    setError(null);
    setContent((current) => ({ ...current, [key]: value }));
  }

  // Warn before a reload or a tab close throws away an unsaved draft. In-app
  // navigation is not covered — the App Router gives no hook for it — so the
  // dirty marker beside the title has to carry that case.
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  async function loadVersions() {
    try {
      const result = await clientFetch<DocumentVersionSummary[]>(
        `/workspace/documents/${document.id}/versions`,
      );
      setVersions(result.data);
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : 'Riwayat gagal dimuat.');
    }
  }

  async function openHistory() {
    setHistoryOpen(true);
    setVersions(null);
    await loadVersions();
  }

  async function showVersion(version: number) {
    try {
      const result = await clientFetch<DocumentVersionDetail>(
        `/workspace/documents/${document.id}/versions/${version}`,
      );
      setPreview(result.data);
      setHistoryOpen(false);
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : 'Versi gagal dimuat.');
    }
  }

  async function save() {
    setBusy(true);
    setError(null);

    try {
      const result = await clientFetch<DocumentDetail>(
        `/workspace/documents/${document.id}/content`,
        {
          method: 'PUT',
          body: {
            content,
            note: note.trim() || null,
            status,
            expectedUpdatedAt: baseUpdatedAt,
          },
        },
      );

      setContent(withDefaults(result.data));
      setBaseUpdatedAt(result.data.updatedAt);
      setSavedVersion(result.data.currentVersion);
      setNote('');
      setDirty(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : 'Dokumen gagal disimpan.');
    } finally {
      setBusy(false);
    }
  }

  async function restore(version: number) {
    setBusy(true);
    setError(null);

    try {
      const result = await clientFetch<DocumentDetail>(
        `/workspace/documents/${document.id}/versions/restore`,
        { method: 'POST', body: { version, note: null } },
      );

      setContent(withDefaults(result.data));
      setStatus(result.data.status);
      setBaseUpdatedAt(result.data.updatedAt);
      setSavedVersion(result.data.currentVersion);
      setPreview(null);
      setDirty(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : 'Versi gagal dikembalikan.');
    } finally {
      setBusy(false);
    }
  }

  /**
   * The PDF is the print page in a new tab, which the browser saves as PDF.
   * It prints what is *saved*, so an unsaved draft is stopped here rather
   * than quietly printed without its latest edits.
   */
  function downloadPdf() {
    if (dirty) {
      setError('Simpan dulu perubahan Anda — PDF dibuat dari versi dokumen yang tersimpan.');
      return;
    }
    window.open(`/cetak/dokumen/${document.id}`, '_blank', 'noopener');
  }

  // What is on the page: the draft, or the version being looked at.
  const shown = preview ? preview.content : content;

  return (
    <div className="space-y-4">
      {error && <Alert tone="danger">{error}</Alert>}

      {savedVersion !== null && (
        <Alert tone="success">Tersimpan sebagai versi {savedVersion}.</Alert>
      )}

      {!canEdit && (
        <Alert tone="warning" title="Mode baca">
          Anda tidak punya izin mengubah dokumen ini.
        </Alert>
      )}

      {preview && (
        <Alert tone="info" title={`Melihat versi ${preview.version}`}>
          <p>
            Disimpan <DateTime value={preview.createdAt} />
            {preview.createdByName && ` oleh ${preview.createdByName}`}.
            {preview.note && ` — ${preview.note}`}
          </p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setPreview(null)}>
              Kembali ke versi terbaru
            </Button>
            {canEdit && (
              <Button
                size="sm"
                loading={busy}
                leftIcon={<RotateCcw className="h-4 w-4" aria-hidden />}
                onClick={() => restore(preview.version)}
              >
                Kembalikan versi ini
              </Button>
            )}
          </div>
        </Alert>
      )}

      <Card>
        <CardHeader
          title={document.title}
          description={
            document.template
              ? `${document.breadcrumb} · ${document.template.name} v${document.template.version}`
              : `${document.breadcrumb} · tanpa template`
          }
          action={
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={STATUS_TONES[status]}>{DOCUMENT_STATUS_LABELS[status]}</Badge>
              {dirty && <span className="text-xs text-amber-600">Belum disimpan</span>}

              {sections.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  leftIcon={<FileDown className="h-4 w-4" aria-hidden />}
                  onClick={downloadPdf}
                >
                  Download PDF
                </Button>
              )}

              <Button
                variant="outline"
                size="sm"
                leftIcon={<History className="h-4 w-4" aria-hidden />}
                onClick={openHistory}
              >
                Riwayat ({document.currentVersion})
              </Button>

              {canEdit && !preview && (
                <Button
                  size="sm"
                  loading={busy}
                  leftIcon={<Save className="h-4 w-4" aria-hidden />}
                  onClick={save}
                >
                  Simpan versi
                </Button>
              )}
            </div>
          }
        />

        {canEdit && !preview && (
          <CardBody className="grid gap-3 border-b border-slate-200 sm:grid-cols-2 dark:border-slate-800">
            <TextField
              label="Catatan perubahan"
              value={note}
              maxLength={500}
              placeholder="Mis. menambahkan scope integrasi SAP"
              hint="Muncul di riwayat, supaya versi ini bisa dikenali tanpa membandingkan isinya."
              onChange={(event) => setNote(event.target.value)}
            />
            <SelectField
              label="Status dokumen"
              value={status}
              options={DOCUMENT_STATUSES.map((value) => ({
                value,
                label: DOCUMENT_STATUS_LABELS[value],
              }))}
              onValueChange={(value) => {
                setDirty(true);
                setStatus(value as DocumentStatus);
              }}
            />
          </CardBody>
        )}

        {/*
          An uploaded document has no template and therefore no sections: its
          content *is* the file, so the viewer is the whole body. The empty
          sheet of paper that used to sit under it said nothing the card above
          had not already said.
        */}
        <div className={sections.length === 0 ? 'p-5' : 'px-5 pt-5'}>
          <DocumentFileViewer
            documentId={document.id}
            canUpload={canEdit && !preview}
            templateDownload={templateDownload}
            uploadLabel={templateDownload ? 'Upload dokumen yang sudah diisi' : undefined}
            emptyHint={
              sections.length === 0
                ? templateDownload
                  ? 'Download template, lengkapi dokumennya, lalu unggah file yang sudah diisi.'
                  : 'Dokumen ini dibuat tanpa template dan belum punya berkas. Unggah berkas untuk mengisinya.'
                : undefined
            }
          />
        </div>

        {sections.length > 0 && (
          <div className="bg-slate-100 p-5 dark:bg-slate-950">
            <div className="mx-auto min-h-[600px] w-full max-w-[810px] bg-white p-7 text-slate-900 shadow-lg">
              <DocumentFillProvider context={document.context}>
                {sections
                  .filter((section) => section.visible)
                  .map((section) => (
                    <Fragment key={section.key}>
                      <SectionField
                        section={section}
                        value={shown[section.key] ?? emptyContentFor(section.type)}
                        onChange={(value) => update(section.key, value)}
                        disabled={readOnly}
                        documentId={document.id}
                        liveData={document.projectData}
                      />
                      {/* Older API responses predate attachments; treat absent as none. */}
                      <SectionAttachments attachments={section.attachments ?? []} />
                    </Fragment>
                  ))}
              </DocumentFillProvider>
            </div>
          </div>
        )}
      </Card>

      <Modal
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        size="lg"
        title="Riwayat versi"
        description="Setiap penyimpanan menambah versi baru. Tidak ada versi yang ditimpa atau dihapus."
        footer={<Button onClick={() => setHistoryOpen(false)}>Tutup</Button>}
      >
        {versions === null ? (
          <p className="py-6 text-center text-sm text-slate-500">Memuat…</p>
        ) : versions.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">
            Belum ada versi. Simpan dokumen untuk membuat versi pertama.
          </p>
        ) : (
          <ol className="space-y-2">
            {versions.map((version) => (
              <li
                key={version.id}
                className={cn(
                  'rounded-lg border px-3 py-2.5',
                  version.version === document.currentVersion
                    ? 'border-sky-300 bg-sky-50/50 dark:border-sky-800 dark:bg-sky-950/40'
                    : 'border-slate-200 dark:border-slate-800',
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    Versi {version.version}
                  </span>
                  <Badge tone={STATUS_TONES[version.status]}>
                    {DOCUMENT_STATUS_LABELS[version.status]}
                  </Badge>
                  {version.restoredFrom !== null && (
                    <Badge tone="warning">dari versi {version.restoredFrom}</Badge>
                  )}
                  {version.version === document.currentVersion && (
                    <span className="text-xs text-sky-700 dark:text-sky-400">terbaru</span>
                  )}

                  <span className="ml-auto flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      leftIcon={<Eye className="h-3.5 w-3.5" aria-hidden />}
                      onClick={() => showVersion(version.version)}
                    >
                      Lihat
                    </Button>
                    {canEdit && version.version !== document.currentVersion && (
                      <Button
                        variant="ghost"
                        size="sm"
                        leftIcon={<RotateCcw className="h-3.5 w-3.5" aria-hidden />}
                        onClick={() => restore(version.version)}
                      >
                        Kembalikan
                      </Button>
                    )}
                  </span>
                </div>

                <p className="mt-0.5 text-xs text-slate-500">
                  <DateTime value={version.createdAt} />
                  {version.createdByName && ` · ${version.createdByName}`}
                </p>

                {version.note && (
                  <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">{version.note}</p>
                )}

                {version.changedSections.length > 0 && (
                  <p className="mt-1 text-xs text-slate-500">
                    Berubah: {version.changedSections.map(sectionTitle).join(', ')}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </Modal>
    </div>
  );
}
