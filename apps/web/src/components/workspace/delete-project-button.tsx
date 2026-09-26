'use client';

import { useMutation } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiClientError, clientFetch } from '@/lib/api/client';
import { useInvalidateWorkspaceTree } from '@/lib/query/use-workspace-tree';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';

export interface DeleteProjectButtonProps {
  projectId: string;
  name: string;
  code: string;
  documentCount: number;
}

/**
 * Deleting a project, drawn beside its title.
 *
 * The page renders this only when `ProjectView.canDelete` — the caller created
 * the project. That is a courtesy; the API applies the same rule and answers
 * 403 to anyone else.
 */
export function DeleteProjectButton({
  projectId,
  name,
  code,
  documentCount,
}: DeleteProjectButtonProps) {
  const router = useRouter();
  const invalidateTree = useInvalidateWorkspaceTree();
  const [open, setOpen] = useState(false);

  const remove = useMutation({
    mutationFn: () => clientFetch(`/workspace/projects/${projectId}`, { method: 'DELETE' }),
    onSuccess: () => {
      // The page it was on no longer exists, and the sidebar still lists it.
      invalidateTree();
      router.replace('/workspace');
    },
  });

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        leftIcon={<Trash2 className="h-4 w-4" aria-hidden />}
        onClick={() => {
          remove.reset();
          setOpen(true);
        }}
      >
        Hapus project
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Hapus project"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Batal
            </Button>
            <Button variant="destructive" loading={remove.isPending} onClick={() => remove.mutate()}>
              Hapus project
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {remove.error && (
            <Alert tone="danger">
              {remove.error instanceof ApiClientError
                ? remove.error.message
                : 'Project gagal dihapus.'}
            </Alert>
          )}
          <p className="text-sm text-slate-600">
            Hapus <strong className="text-slate-900">{name}</strong> beserta {documentCount}{' '}
            dokumennya? Project hilang dari semua daftar dan tidak bisa dibuka lagi, tapi riwayatnya
            tetap tersimpan untuk audit. Kode <strong className="text-slate-900">{code}</strong>{' '}
            bisa dipakai lagi.
          </p>
        </div>
      </Dialog>
    </>
  );
}
