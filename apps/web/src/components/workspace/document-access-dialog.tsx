'use client';

import { EyeOff, RotateCcw, Search, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  PROJECT_JOB_ROLE_LABELS,
  PROJECT_ROLE_LABELS,
  setDocumentAccessSchema,
  type DocumentAccessView,
} from '@dtrace/shared';
import { ApiClientError, clientFetch } from '@/lib/api/client';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Modal } from '@/components/ui/modal';
import { cn } from '@/lib/utils/cn';

/** The four columns, in the order they are granted and revoked. */
const PERMISSIONS = [
  { key: 'canView', label: 'View', hint: 'Tanpa ini, dokumen hilang sepenuhnya' },
  { key: 'canCreate', label: 'Create', hint: 'Menambah versi dan lampiran' },
  { key: 'canEdit', label: 'Edit', hint: 'Mengubah isi dokumen' },
  { key: 'canDelete', label: 'Delete', hint: 'Menghapus dokumen' },
] as const;

type PermissionKey = (typeof PERMISSIONS)[number]['key'];

/** True when a row says exactly what the member's role already says. */
function followsInherited(row: DocumentAccessView): boolean {
  return (
    row.canView === row.inherited.view &&
    row.canCreate === row.inherited.create &&
    row.canEdit === row.inherited.edit &&
    row.canDelete === row.inherited.delete
  );
}

export interface DocumentAccessDialogProps {
  /** The document whose access list is being edited, or null when closed. */
  document: { id: string; title: string } | null;
  onClose: () => void;
}

/**
 * Who may do what with one document.
 *
 * The grid is per member, and unticking **Lihat** is the restriction: that
 * person stops seeing the document in their sidebar, their lists and every API
 * result, not merely in this table. The other three columns are disabled once
 * Lihat is off, because editing something you cannot open is not a state worth
 * being able to save.
 *
 * Only rows that differ from the member's role are stored. A row left alone
 * keeps following that role, so promoting someone later actually changes what
 * they can do here — which is why "Ikuti bawaan" exists as a real action and
 * not just as a label.
 */
export function DocumentAccessDialog({ document, onClose }: DocumentAccessDialogProps) {
  const [rows, setRows] = useState<DocumentAccessView[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!document) {
      setRows(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setRows(null);
    setError(null);
    setSaved(false);
    setSearch('');
    setLoading(true);

    void clientFetch<DocumentAccessView[]>(`/workspace/documents/${document.id}/access`)
      .then((result) => {
        if (!cancelled) setRows(result.data);
      })
      .catch((caught) => {
        if (cancelled) return;
        setError(
          caught instanceof ApiClientError && caught.status === 404
            ? 'Dokumen ini sudah tidak ada. Muat ulang halaman untuk menyegarkan daftar.'
            : caught instanceof ApiClientError
              ? caught.message
              : 'Daftar akses gagal dimuat.',
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [document]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle || !rows) return rows ?? [];
    return rows.filter(
      (row) =>
        row.name.toLowerCase().includes(needle) ||
        row.email.toLowerCase().includes(needle) ||
        PROJECT_JOB_ROLE_LABELS[row.jobRole].toLowerCase().includes(needle),
    );
  }, [rows, search]);

  function update(userId: string, patch: Partial<Record<PermissionKey, boolean>>) {
    setSaved(false);
    setRows((current) =>
      (current ?? []).map((row) => {
        if (row.userId !== userId) return row;
        const next = { ...row, ...patch };
        // Turning Lihat off clears the rest, so a saved row can never claim
        // someone may edit a document they cannot open.
        if (!next.canView) return { ...next, canCreate: false, canEdit: false, canDelete: false };
        return next;
      }),
    );
  }

  /** Puts one row back to whatever the member's role says. */
  function resetRow(row: DocumentAccessView) {
    update(row.userId, {
      canView: row.inherited.view,
      canCreate: row.inherited.create,
      canEdit: row.inherited.edit,
      canDelete: row.inherited.delete,
    });
  }

  function resetAll() {
    setSaved(false);
    setRows((current) =>
      (current ?? []).map((row) => ({
        ...row,
        canView: row.inherited.view,
        canCreate: row.inherited.create,
        canEdit: row.inherited.edit,
        canDelete: row.inherited.delete,
      })),
    );
  }

  async function save() {
    if (!document || !rows) return;
    setBusy(true);
    setError(null);

    const parsed = setDocumentAccessSchema.safeParse({
      entries: rows.map((row) => ({
        userId: row.userId,
        canView: row.canView,
        canCreate: row.canCreate,
        canEdit: row.canEdit,
        canDelete: row.canDelete,
      })),
    });

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Data tidak valid');
      setBusy(false);
      return;
    }

    try {
      const result = await clientFetch<DocumentAccessView[]>(
        `/workspace/documents/${document.id}/access`,
        { method: 'PUT', body: parsed.data },
      );
      setRows(result.data);
      setSaved(true);
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : 'Akses gagal disimpan.');
    } finally {
      setBusy(false);
    }
  }

  const restricted = (rows ?? []).filter((row) => !row.canView);
  const overrides = (rows ?? []).filter((row) => !followsInherited(row));

  return (
    <Modal
      open={document !== null}
      onClose={onClose}
      size="xl"
      title="Akses dokumen"
      description={
        document ? `Atur siapa yang boleh melihat dan mengubah "${document.title}".` : undefined
      }
      footer={
        <>
          {rows && rows.length > 0 && (
            <Button
              variant="ghost"
              disabled={overrides.length === 0}
              leftIcon={<RotateCcw className="h-4 w-4" aria-hidden />}
              onClick={resetAll}
            >
              Ikuti bawaan semua
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            Tutup
          </Button>
          <Button loading={busy} disabled={rows === null} onClick={save}>
            Simpan
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <Alert tone="danger">{error}</Alert>}
        {saved && <Alert tone="success">Akses tersimpan.</Alert>}

        {/* Loading and failure are mutually exclusive: showing both at once
            says the screen does not know which one it is in. */}
        {loading && !error && (
          <p className="py-8 text-center text-sm text-slate-500">Memuat…</p>
        )}

        {!loading && !error && rows && rows.length === 0 && (
          <p className="py-8 text-center text-sm text-slate-500">
            Belum ada anggota tim di project ini.
          </p>
        )}

        {!loading && rows && rows.length > 0 && (
          <>
            {restricted.length > 0 && (
              <Alert tone="warning" title={`${restricted.length} orang dibatasi`}>
                Dokumen ini hilang sepenuhnya untuk {restricted.map((row) => row.name).join(', ')}
                {' '}— bukan terkunci, tetapi tidak muncul di sidebar, daftar, maupun pencarian
                mereka.
              </Alert>
            )}

            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <div className="relative min-w-[16rem] flex-1">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                  aria-hidden
                />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Cari nama, email, atau peran"
                  aria-label="Cari anggota"
                  className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm focus:outline-2 focus:outline-sky-500 dark:border-slate-700 dark:bg-slate-900"
                />
              </div>
              {/* `shrink-0` so the count is never clipped; the search box gives
                  up width first, because a truncated summary is unreadable
                  while a narrower input is merely narrower. */}
              <p className="shrink-0 text-xs text-slate-500">
                {overrides.length === 0
                  ? 'Semua mengikuti hak akses anggota'
                  : `${overrides.length} diatur khusus`}
              </p>
            </div>

            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900">
                  <tr>
                    {/* The member column takes whatever the fixed ones leave,
                        so a long name and its badges stay on one line. */}
                    <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Anggota
                    </th>
                    {PERMISSIONS.map((permission) => (
                      <th key={permission.key} className="w-32 px-2 py-2.5 text-center align-top">
                        <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {permission.label}
                        </span>
                        <span className="mt-0.5 block text-[10px] font-normal normal-case text-slate-400">
                          {permission.hint}
                        </span>
                      </th>
                    ))}
                    <th className="w-12 px-2 py-2.5" />
                  </tr>
                </thead>

                <tbody>
                  {visible.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-sm text-slate-500">
                        Tidak ada anggota yang cocok dengan pencarian ini.
                      </td>
                    </tr>
                  )}

                  {visible.map((row) => {
                    const custom = !followsInherited(row);

                    return (
                      <tr
                        key={row.userId}
                        className={cn(
                          'border-t border-slate-100 dark:border-slate-800',
                          !row.canView && 'bg-red-50/60 dark:bg-red-950/30',
                        )}
                      >
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="flex items-center gap-1.5 font-medium text-slate-900 dark:text-slate-100">
                              {row.name}
                              {!row.canView && (
                                <EyeOff className="h-3.5 w-3.5 text-red-500" aria-label="Dibatasi" />
                              )}
                            </span>
                            <span className="text-xs text-slate-500">{row.email}</span>
                          </div>

                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            <Badge tone="neutral">{PROJECT_JOB_ROLE_LABELS[row.jobRole]}</Badge>
                            <Badge tone="info">{PROJECT_ROLE_LABELS[row.projectRole]}</Badge>
                            {custom ? (
                              <Badge tone="warning">diatur khusus</Badge>
                            ) : (
                              <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] text-slate-500">
                                <ShieldCheck className="h-3 w-3" aria-hidden />
                                ikut hak akses anggota
                              </span>
                            )}
                          </div>
                        </td>

                        {PERMISSIONS.map((permission) => (
                          <td key={permission.key} className="px-2 py-3">
                            {/* Centred by the cell rather than by the control:
                                the checkbox ships with a label slot, and an
                                empty one would drag it off the column axis. */}
                            <span className="flex justify-center">
                              <Checkbox
                                label=""
                                checked={row[permission.key]}
                                disabled={permission.key !== 'canView' && !row.canView}
                                aria-label={`${row.name} — ${permission.label}`}
                                title={permission.hint}
                                onChange={(event) =>
                                  update(row.userId, { [permission.key]: event.target.checked })
                                }
                              />
                            </span>
                          </td>
                        ))}

                        <td className="px-2 py-3 text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={!custom}
                            aria-label={`Kembalikan ${row.name} ke hak akses anggota`}
                            title="Ikuti hak akses anggota"
                            onClick={() => resetRow(row)}
                          >
                            <RotateCcw className="h-4 w-4" aria-hidden />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p className="text-xs text-slate-500">
              Hanya baris yang berbeda dari hak akses anggota yang disimpan. Baris yang mengikuti
              bawaan akan ikut berubah bila peran orangnya diubah nanti.
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}
