'use client';

import { useMutation } from '@tanstack/react-query';
import { Mail } from 'lucide-react';
import { useState } from 'react';
import {
  PROJECT_JOB_ROLES,
  PROJECT_JOB_ROLE_LABELS,
  type ProjectJobRole,
} from '@dtrace/shared';
import { ApiClientError, clientFetch } from '@/lib/api/client';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { SelectField, TextField } from '@/components/ui/field';

/**
 * Invites somebody who has no account yet.
 *
 * The invitation carries the project and the job role, so accepting it puts
 * the person straight onto the team — the alternative is an account that
 * exists and belongs nowhere, which somebody then has to remember to place.
 */
export function InviteMemberDialog({
  projectId,
  email,
  initialJobRole = 'BA',
  onClose,
  onInvited,
}: {
  projectId: string;
  email: string;
  /** The role group the invitation was started from. */
  initialJobRole?: ProjectJobRole;
  onClose: () => void;
  onInvited: () => void;
}) {
  const [name, setName] = useState('');
  const [jobRole, setJobRole] = useState<ProjectJobRole>(initialJobRole);

  const invite = useMutation({
    mutationFn: () =>
      clientFetch('/invitations', {
        method: 'POST',
        body: { email, name: name.trim(), projectId, jobRole },
      }),
    onSuccess: () => onInvited(),
  });

  const error =
    invite.error instanceof ApiClientError
      ? invite.error.message
      : invite.error
        ? 'Undangan gagal dikirim.'
        : null;

  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title="Undang lewat email"
      description="Orang ini belum punya akun. Kami kirimkan tautan untuk membuat password."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Batal
          </Button>
          <Button
            leftIcon={<Mail className="h-4 w-4" aria-hidden />}
            loading={invite.isPending}
            disabled={name.trim().length < 2}
            onClick={() => invite.mutate()}
          >
            Kirim undangan
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}

        <div>
          <span className="mb-1.5 block text-sm font-medium text-slate-700">Email</span>
          <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            {email}
          </p>
        </div>

        <TextField
          label="Nama"
          name="invite-name"
          maxLength={80}
          placeholder="Nama yang disapa di email undangan"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />

        <SelectField
          label="Peran di project"
          name="invite-role"
          value={jobRole}
          hint="Peran menjelaskan pekerjaannya, bukan hak aksesnya."
          onValueChange={(value) => value && setJobRole(value as ProjectJobRole)}
          options={PROJECT_JOB_ROLES.map((role) => ({
            value: role,
            label: PROJECT_JOB_ROLE_LABELS[role],
          }))}
        />

        <p className="text-xs text-slate-500">
          Tautannya berlaku 7 hari dan hanya bisa dipakai sekali. Statusnya bisa dilihat di daftar
          anggota sampai undangan dijawab.
        </p>
      </div>
    </Dialog>
  );
}
