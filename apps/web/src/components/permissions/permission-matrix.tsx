'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Download,
  Eye,
  Pencil,
  PenLine,
  Plus,
  RotateCcw,
  Save,
  Settings,
  ShieldCheck,
  Trash2,
  Workflow,
} from 'lucide-react';
import {
  PERMISSIONS,
  PERMISSION_GROUPS,
  PROJECT_ROLES,
  PROJECT_ROLE_LABELS,
  findMatrixViolations,
  type PermissionIcon,
  type PermissionMatrix as Matrix,
  type PermissionMatrixView,
  type ProjectRole,
} from '@dtrace/shared';
import { ApiClientError, clientFetch } from '@/lib/api/client';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { cn } from '@/lib/utils/cn';

const ICONS: Record<PermissionIcon, typeof Eye> = {
  view: Eye,
  create: Plus,
  edit: Pencil,
  delete: Trash2,
  download: Download,
  decision: PenLine,
  stage: Workflow,
  settings: Settings,
  shield: ShieldCheck,
};

/**
 * The Role & Akses screen.
 *
 * It is a policy table, not a grant: saving it changes what a project role is
 * *capable* of, never who holds that role. The page says so out loud, because
 * a permission screen that looks like it hands out access is how people end up
 * surprised by who can do what.
 */
export function PermissionMatrixEditor({
  initial,
  canEdit,
}: {
  initial: PermissionMatrixView;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Matrix>(initial.matrix);
  const [baseVersion, setBaseVersion] = useState(initial.updatedAt);
  const [status, setStatus] = useState<{ tone: 'success' | 'danger'; message: string } | null>(null);

  const { data } = useQuery({
    queryKey: ['role-permissions'],
    queryFn: async () => (await clientFetch<PermissionMatrixView>('/role-permissions')).data,
    initialData: initial,
  });

  const save = useMutation({
    mutationFn: () =>
      clientFetch<PermissionMatrixView>('/role-permissions', {
        method: 'PUT',
        body: { expectedUpdatedAt: baseVersion, matrix: draft },
      }),
    onSuccess: async (result) => {
      setDraft(result.data.matrix);
      setBaseVersion(result.data.updatedAt);
      setStatus({ tone: 'success', message: 'Matriks tersimpan.' });
      await queryClient.invalidateQueries({ queryKey: ['role-permissions'] });
    },
    onError: (error) => {
      const [detail] = error instanceof ApiClientError ? (error.details ?? []) : [];
      setStatus({
        tone: 'danger',
        message: detail
          ? detail.message
          : error instanceof ApiClientError
            ? error.message
            : 'Gagal menyimpan matriks.',
      });
    },
  });

  const isDirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(data.matrix),
    [draft, data.matrix],
  );

  const violations = useMemo(() => findMatrixViolations(draft), [draft]);

  /**
   * Toggling a cell also keeps the dependency honest: switching a parent off
   * takes its dependants with it, and switching a dependant on brings the
   * parent along. Without that, the save would simply be rejected and the
   * operator would have to work out why.
   */
  function toggle(permissionKey: string, role: ProjectRole) {
    setStatus(null);

    setDraft((current) => {
      const next: Matrix = structuredClone(current);
      const target = !next[permissionKey]![role];
      next[permissionKey]![role] = target;

      const definition = PERMISSIONS.find((item) => item.key === permissionKey);

      if (target && definition?.requires) {
        next[definition.requires]![role] = true;
      }

      if (!target) {
        for (const dependant of PERMISSIONS.filter((item) => item.requires === permissionKey)) {
          next[dependant.key]![role] = false;
        }
      }

      return next;
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Role dan Akses"
        description="Matriks izin untuk empat role yang melekat pada project. Halaman ini tidak memberi akses kepada siapa pun — keanggotaan project beserta rolenya ada di menu User."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Alert tone="info">
          <strong>Kolom Collaborator adalah batas atas, bukan pemberian.</strong> Yang disetel di
          sini hanyalah aksi yang boleh diberikan Manager kepada Collaborator di project-nya.
          Mematikannya membuat Manager tidak lagi bisa memberikan aksi itu kepada siapa pun.
        </Alert>
        <Alert tone="info">
          <strong>Super Admin terkunci.</strong> Ia bukan role project: ia memegang semua izin di
          seluruh project dan tidak bisa dikurangi dari halaman ini.
        </Alert>
      </div>

      {status && <Alert tone={status.tone}>{status.message}</Alert>}

      {violations.length > 0 && (
        <Alert tone="warning" title="Ada kombinasi yang belum masuk akal">
          <ul className="list-disc space-y-0.5 pl-4">
            {violations.slice(0, 3).map((violation) => (
              <li key={`${violation.permissionKey}-${violation.role}`}>{violation.message}</li>
            ))}
          </ul>
        </Alert>
      )}

      <Card className="overflow-hidden">
        {/* A matrix is wide by nature. Rather than hiding columns on a phone,
            it scrolls sideways with the feature column pinned, so a row can
            always be read against its label. */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-3xl border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800">
                <th
                  scope="col"
                  className="sticky left-0 z-10 bg-white px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-900 dark:text-slate-400"
                >
                  Fitur / Hak Akses
                </th>
                <th scope="col" className="px-3 py-3 text-center text-sm font-medium">
                  Super Admin
                </th>
                {PROJECT_ROLES.map((role) => (
                  <th key={role} scope="col" className="px-3 py-3 text-center text-sm font-medium">
                    {PROJECT_ROLE_LABELS[role]}
                    {role === 'COLLABORATOR' && (
                      <span className="block text-xs font-normal text-slate-400">batas atas</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {PERMISSION_GROUPS.map((group) => {
                const rows = PERMISSIONS.filter((permission) => permission.group === group);
                if (rows.length === 0) return null;

                return (
                  <PermissionGroupRows
                    key={group}
                    group={group}
                    rows={rows}
                    draft={draft}
                    canEdit={canEdit}
                    onToggle={toggle}
                  />
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-3 dark:border-slate-800">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Perubahan matriks tercatat di Audit Log.
            {data.updatedByEmail && (
              <> Terakhir diubah oleh {data.updatedByEmail}.</>
            )}
          </p>

          {canEdit && (
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setDraft(data.matrix);
                  setStatus(null);
                }}
                disabled={!isDirty || save.isPending}
                leftIcon={<RotateCcw className="h-4 w-4" aria-hidden />}
              >
                Kembalikan
              </Button>
              <Button
                onClick={() => save.mutate()}
                loading={save.isPending}
                disabled={!isDirty || violations.length > 0 || save.isPending}
                leftIcon={<Save className="h-4 w-4" aria-hidden />}
              >
                Simpan
              </Button>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

function PermissionGroupRows({
  group,
  rows,
  draft,
  canEdit,
  onToggle,
}: {
  group: string;
  rows: typeof PERMISSIONS;
  draft: Matrix;
  canEdit: boolean;
  onToggle: (key: string, role: ProjectRole) => void;
}) {
  return (
    <>
      {/* KONSOL has no heading: it is a single system-level row, not a feature
          area, and labelling it would imply there are more like it. */}
      {group !== 'KONSOL' && (
        <tr className="bg-slate-50 dark:bg-slate-800/50">
          <th
            scope="colgroup"
            colSpan={2 + PROJECT_ROLES.length}
            className="sticky left-0 px-5 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
          >
            {group}
          </th>
        </tr>
      )}

      {rows.map((permission) => {
        const Icon = ICONS[permission.icon];

        return (
          <tr
            key={permission.key}
            className="border-b border-slate-100 last:border-0 dark:border-slate-800"
          >
            <th
              scope="row"
              className="sticky left-0 z-10 bg-white px-5 py-3 text-left font-normal dark:bg-slate-900"
            >
              <div className="flex items-start gap-3">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                <div className="min-w-0">
                  <p className="font-medium text-slate-900 dark:text-slate-100">
                    {permission.label}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {permission.description}
                  </p>
                </div>
              </div>
            </th>

            {/* Super Admin: always on, never editable. Shown rather than hidden
                so the row reads as a complete statement of who can do what. */}
            <td className="px-3 py-3 text-center">
              <input
                type="checkbox"
                checked
                disabled
                aria-label={`Super Admin: ${permission.label} (selalu aktif)`}
                title="Super Admin memegang semua izin dan tidak bisa diubah."
                className="h-4 w-4 rounded border-slate-300 text-sky-400 opacity-60"
              />
            </td>

            {PROJECT_ROLES.map((role) => {
              const locked = permission.lockedFor?.includes(role) ?? false;
              const checked = draft[permission.key]?.[role] ?? false;

              return (
                <td key={role} className="px-3 py-3 text-center">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={locked || !canEdit}
                    onChange={() => onToggle(permission.key, role)}
                    aria-label={`${PROJECT_ROLE_LABELS[role]}: ${permission.label}`}
                    title={
                      locked
                        ? 'Izin ini bukan kapabilitas project dan tidak bisa diberikan lewat matriks.'
                        : undefined
                    }
                    className={cn(
                      'h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500',
                      (locked || !canEdit) && 'cursor-not-allowed opacity-40',
                    )}
                  />
                </td>
              );
            })}
          </tr>
        );
      })}
    </>
  );
}

