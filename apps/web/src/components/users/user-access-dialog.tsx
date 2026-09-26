'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Network, UserRound } from 'lucide-react';
import type { NodeView, User } from '@dtrace/shared';
import { ApiClientError, clientFetch } from '@/lib/api/client';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { TextField } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import { NodeAccessPicker, type NodeAccessDraft } from './node-access-picker';

interface UserAccessDialogProps {
  /** The user being edited, or null when creating. */
  user: User | null;
  open: boolean;
  onClose: () => void;
}

/**
 * Create or edit an account together with what it can reach.
 *
 * The system role is deliberately absent. Every account is created as an
 * ordinary user; Super Admin comes from the seed. What someone can actually do
 * is decided per node in the panel below, which is the question an operator is
 * really asking when they open this form.
 *
 * The password is absent for the same reason: this form is about identity and
 * access, and a field that quietly resets a password does not belong next to a
 * rename.
 */
export function UserAccessDialog({ user, open, onClose }: UserAccessDialogProps) {
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isChecker, setIsChecker] = useState(false);
  const [access, setAccess] = useState<Map<string, NodeAccessDraft>>(new Map());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const { data: nodes = [] } = useQuery({
    queryKey: ['nodes', { includeInactive: false }],
    queryFn: async () => (await clientFetch<NodeView[]>('/nodes')).data,
    enabled: open,
  });

  // Re-seed on open so editing one account never shows the last one's ticks.
  useEffect(() => {
    if (!open) return;

    setErrors({});
    setFormError(null);
    setPassword('');
    setName(user?.name ?? '');
    setEmail(user?.email ?? '');
    setIsChecker(user?.isChecker ?? false);
    setAccess(
      new Map(
        (user?.nodeAccess ?? []).map((entry) => [
          entry.nodeId,
          { role: entry.role, canCreateDocument: entry.canCreateDocument },
        ]),
      ),
    );
  }, [open, user]);

  const payloadAccess = useMemo(
    () =>
      [...access.entries()].map(([nodeId, draft]) => ({
        nodeId,
        role: draft.role,
        canCreateDocument: draft.canCreateDocument,
      })),
    [access],
  );

  const save = useMutation({
    mutationFn: () =>
      user
        ? clientFetch<User>(`/users/${user.id}`, {
            method: 'PATCH',
            body: { name, email, isChecker, nodeAccess: payloadAccess },
          })
        : clientFetch<User>('/users', {
            method: 'POST',
            body: { name, email, password, isChecker, nodeAccess: payloadAccess },
          }),
    onSuccess: async () => {
      // Both the list and the cards move when an account changes.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['users'] }),
        queryClient.invalidateQueries({ queryKey: ['user-stats'] }),
      ]);
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

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={user ? 'Ubah User & Akses' : 'Tambah User & Akses'}
      description={
        user
          ? 'Ubah data akun sekaligus akses node dalam satu form. Password tidak diubah di sini.'
          : 'Buat akun baru sekaligus tentukan node yang boleh diaksesnya.'
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            Batal
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending}>
            Simpan
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        {formError && <Alert tone="danger">{formError}</Alert>}

        <section className="space-y-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
          <header className="flex items-start gap-3">
            <span className="rounded-lg bg-sky-50 p-2 text-sky-600 dark:bg-sky-950 dark:text-sky-300">
              <UserRound className="h-4 w-4" aria-hidden />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Informasi User
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Lengkapi informasi dasar akun user.
              </p>
            </div>
          </header>

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Nama"
              name="user-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              error={errors['name']}
            />
            <TextField
              label="Email"
              name="user-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              error={errors['email']}
            />
          </div>

          {!user && (
            <TextField
              label="Password awal"
              name="user-password"
              type="password"
              autoComplete="new-password"
              value={password}
              hint="Minimal 12 karakter, mengandung huruf besar dan angka."
              onChange={(event) => setPassword(event.target.value)}
              error={errors['password']}
            />
          )}

          <div className="rounded-lg border border-slate-200 px-4 py-3 dark:border-slate-700">
            <Switch
              checked={isChecker}
              onChange={setIsChecker}
              label="Checker"
              description="Hanya Checker yang boleh membuat Form Checklist dan mencatat CCB Go/NoGo."
            />
          </div>
        </section>

        <section className="space-y-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
          <header className="flex items-start gap-3">
            <span className="rounded-lg bg-sky-50 p-2 text-sky-600 dark:bg-sky-950 dark:text-sky-300">
              <Network className="h-4 w-4" aria-hidden />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Akses Node
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Pilih node yang boleh diakses user, dan tentukan perannya di node tersebut.
              </p>
            </div>
          </header>

          {errors['nodeAccess'] && <Alert tone="danger">{errors['nodeAccess']}</Alert>}

          <NodeAccessPicker
            nodes={nodes}
            value={access}
            onChange={setAccess}
            disabled={save.isPending}
          />

          <p className="text-xs text-slate-500 dark:text-slate-400">
            {access.size === 0
              ? 'Belum ada node yang dipilih.'
              : `${access.size} node dipilih.`}
          </p>
        </section>
      </div>
    </Modal>
  );
}
