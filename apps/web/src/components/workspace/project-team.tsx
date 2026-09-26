'use client';

import { Clock, Plus, Search, ShieldCheck, Trash2, UserPlus, Users } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  INVITATION_STATUS_LABELS,
  type InvitationView,
  PROJECT_JOB_ROLES,
  PROJECT_JOB_ROLE_LABELS,
  PROJECT_ROLES,
  PROJECT_ROLE_LABELS,
  type ProjectJobRole,
  type ProjectMemberView,
  type ProjectRole,
} from '@dtrace/shared';
import { ApiClientError, clientFetch } from '@/lib/api/client';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AsyncSelect, type AsyncOption } from '@/components/ui/async-select';
import { SelectControl, SelectField, TextField } from '@/components/ui/field';
import { InviteMemberDialog } from './invite-member-dialog';
import { Modal } from '@/components/ui/modal';

interface Candidate {
  id: string;
  name: string;
  email: string;
}

export interface ProjectTeamProps {
  projectId: string;
  /** Only someone who manages the project may change the team. */
  canManage: boolean;
  open: boolean;
  onClose: () => void;
}

/**
 * The project team, grouped by job role.
 *
 * Every role is listed whether anyone holds it or not, because each one must be
 * filled and an empty seat is invisible in a plain member list. A role is a
 * group rather than a slot: Developer and QA usually hold several people.
 *
 * Two kinds of row sit in one table, and the badge tells them apart. Someone
 * **added here** has a membership row: their job role can change and they can
 * be removed. Someone who is here **by node grant** was given access to the
 * whole node by an administrator — removing them from this project would be a
 * lie, because the grant above still lets them in. Showing both is the only
 * honest answer to "who can open this project".
 */
/** Enough to decide whether to offer "invite"; the API validates properly. */
const looksLikeEmail = (value: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);

export function ProjectTeam({ projectId, canManage, open, onClose }: ProjectTeamProps) {
  const [members, setMembers] = useState<ProjectMemberView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const [selectedCandidate, setSelectedCandidate] = useState<AsyncOption | null>(null);
  const [invitations, setInvitations] = useState<InvitationView[]>([]);
  /** The address being invited, or null when nobody is. */
  const [inviting, setInviting] = useState<string | null>(null);
  /** What is typed in the user picker, so the invite offer survives it closing. */
  const [typedSearch, setTypedSearch] = useState('');
  const [form, setForm] = useState({ userId: '', jobRole: 'BA' as ProjectJobRole });
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<ProjectJobRole | ''>('');
  const [onlyEmpty, setOnlyEmpty] = useState(false);

  /**
   * Nothing was picked, but what was typed is an address.
   *
   * That is not a dead end — it is the case where somebody has no account yet,
   * which is exactly what an invitation is for. So the dialog offers it as the
   * primary action rather than leaving the reader with a disabled button and
   * no explanation.
   */
  const canInvite = !form.userId && looksLikeEmail(typedSearch);

  const fetchCandidates = useCallback(
    async (search: string, page: number) => {
      const result = await clientFetch<Candidate[]>(
        `/workspace/projects/${projectId}/member-candidates`,
        { searchParams: { search: search || undefined, page } },
      );

      const payload = result.data as unknown as { items: Candidate[]; hasNext: boolean };

      return {
        options: payload.items.map((candidate) => ({
          value: candidate.id,
          label: candidate.name,
          hint: candidate.email,
        })),
        hasNext: payload.hasNext,
      };
    },
    [projectId],
  );

  async function load() {
    try {
      /*
       * Both lists come from the server, together.
       *
       * The invitation list used to be built locally from whatever this
       * session happened to send, which meant it vanished on reopen and could
       * show rows the server had already superseded. Reading it is the only
       * way the panel can be right about invitations somebody else sent, or
       * about one that has since been accepted.
       */
      const [result, invited] = await Promise.all([
        clientFetch<ProjectMemberView[]>(`/workspace/projects/${projectId}/members`),
        clientFetch<InvitationView[]>(`/invitations/project/${projectId}`).catch(() => null),
      ]);

      setMembers(result.data);
      if (invited) {
        // Answered invitations are already in the member list above; repeating
        // them here would list the same person twice.
        setInvitations(invited.data.filter((invitation) => invitation.status === 'PENDING'));
      }
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : 'Tim gagal dimuat.');
    }
  }

  useEffect(() => {
    if (!open) return;
    void load();
    // `projectId` is the only input; re-running on every render would poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, open]);

  async function addMember() {
    setBusy(true);
    setError(null);
    try {
      await clientFetch<ProjectMemberView>(`/workspace/projects/${projectId}/members`, {
        method: 'POST',
        // Project role is deliberately not offered here: everyone joins as a
        // Collaborator, and raising someone stays a separate, visible act.
        body: { userId: form.userId, jobRole: form.jobRole, projectRole: 'COLLABORATOR' },
      });
      setAddOpen(false);
      setForm({ userId: '', jobRole: 'BA' });
      await load();
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : 'Anggota gagal ditambahkan.');
    } finally {
      setBusy(false);
    }
  }

  async function patchMember(member: ProjectMemberView, body: Record<string, unknown>) {
    setError(null);
    try {
      await clientFetch<void>(`/workspace/projects/${projectId}/members/${member.id}`, {
        method: 'PATCH',
        body,
      });
      await load();
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : 'Perubahan gagal disimpan.');
    }
  }

  async function removeMember(member: ProjectMemberView) {
    setError(null);
    try {
      await clientFetch<void>(`/workspace/projects/${projectId}/members/${member.id}`, {
        method: 'DELETE',
      });
      await load();
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : 'Anggota gagal dihapus.');
    }
  }

  function openAdd(jobRole: ProjectJobRole) {
    setForm({ userId: '', jobRole });
    setSelectedCandidate(null);
    setTypedSearch('');
    setAddOpen(true);
  }

  /*
   * Every role is a group, filled or not.
   *
   * A project needs each of these seats taken, and an empty seat is the thing
   * worth seeing — a flat member list can only show who is there, never who is
   * missing. Developer and QA routinely hold several people, so a group is a
   * list rather than a single slot.
   */
  const needle = search.trim().toLowerCase();
  const matches = (name: string, email: string) =>
    !needle || name.toLowerCase().includes(needle) || email.toLowerCase().includes(needle);

  const groups = PROJECT_JOB_ROLES.map((jobRole) => ({
    jobRole,
    members: (members ?? []).filter(
      (member) => member.jobRole === jobRole && matches(member.name, member.email),
    ),
    invitations: invitations.filter(
      (invitation) => invitation.jobRole === jobRole && matches('', invitation.email),
    ),
    filled: (members ?? []).some((member) => member.jobRole === jobRole),
  }));

  const filledCount = groups.filter((group) => group.filled).length;
  const visibleGroups = groups.filter(
    (group) =>
      (!roleFilter || group.jobRole === roleFilter) &&
      (!onlyEmpty || !group.filled) &&
      // A search hides the groups it finds nothing in; without one, every
      // role shows so the empty ones stay visible.
      (!needle || group.members.length > 0 || group.invitations.length > 0),
  );
  const unassignedInvitations = invitations.filter(
    (invitation) => !invitation.jobRole && matches('', invitation.email),
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title="Tim Project"
      description="Siapa yang mengerjakan project ini, dan hak akses mereka."
      footer={
        <>
          {canManage && (
            <Button
              variant="outline"
              leftIcon={<Plus className="h-4 w-4" aria-hidden />}
              onClick={() =>
                openAdd(
                  PROJECT_JOB_ROLES.find(
                    (jobRole) => !(members ?? []).some((member) => member.jobRole === jobRole),
                  ) ?? 'DEVELOPER',
                )
              }
            >
              Tambah anggota
            </Button>
          )}
          <Button onClick={onClose}>Tutup</Button>
        </>
      }
    >
      {error && <Alert tone="danger">{error}</Alert>}

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-55 flex-1">
          <TextField
            label="Cari anggota"
            name="team-search"
            placeholder="Nama atau email"
            leadingIcon={<Search className="h-4 w-4" aria-hidden />}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="w-full sm:w-56">
          <SelectField
            label="Peran"
            name="team-role-filter"
            placeholder="Semua peran"
            value={roleFilter}
            options={PROJECT_JOB_ROLES.map((jobRole) => ({
              value: jobRole,
              label: PROJECT_JOB_ROLE_LABELS[jobRole],
            }))}
            onValueChange={(value) => setRoleFilter(value as ProjectJobRole | '')}
          />
        </div>
        <Button
          variant={onlyEmpty ? 'default' : 'outline'}
          onClick={() => setOnlyEmpty((value) => !value)}
          aria-pressed={onlyEmpty}
        >
          Belum terisi
        </Button>
      </div>

      {members !== null && (
        <p
          className={
            filledCount === PROJECT_JOB_ROLES.length
              ? 'mt-3 text-xs text-emerald-700'
              : 'mt-3 text-xs text-amber-700'
          }
        >
          {filledCount} dari {PROJECT_JOB_ROLES.length} peran terisi
          {filledCount < PROJECT_JOB_ROLES.length && ' — semua peran wajib punya anggota.'}
        </p>
      )}

      <div className="mt-3 max-h-[60vh] space-y-3 overflow-y-auto pr-1">
        {members === null ? (
          <p className="py-6 text-center text-sm text-slate-500">Memuat tim…</p>
        ) : visibleGroups.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">
            Tidak ada peran atau anggota yang cocok.
          </p>
        ) : (
          visibleGroups.map((group) => (
            <section
              key={group.jobRole}
              aria-label={PROJECT_JOB_ROLE_LABELS[group.jobRole]}
              className={
                group.filled
                  ? 'rounded-lg border border-slate-200 dark:border-slate-800'
                  : 'rounded-lg border border-dashed border-amber-300 bg-amber-50/40 dark:border-amber-800 dark:bg-amber-950/20'
              }
            >
              <header className="flex items-center gap-2 border-b border-inherit px-3 py-2">
                <Users className="h-4 w-4 text-slate-400" aria-hidden />
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {PROJECT_JOB_ROLE_LABELS[group.jobRole]}
                </h3>
                {group.filled ? (
                  <Badge tone="neutral">
                    {(members ?? []).filter((m) => m.jobRole === group.jobRole).length} orang
                  </Badge>
                ) : (
                  <Badge tone="warning">Belum terisi</Badge>
                )}
                {canManage && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto"
                    leftIcon={<Plus className="h-4 w-4" aria-hidden />}
                    onClick={() => openAdd(group.jobRole)}
                  >
                    Tambah
                  </Button>
                )}
              </header>

              {group.members.length === 0 && group.invitations.length === 0 ? (
                <p className="px-3 py-3 text-xs text-slate-500">
                  Belum ada anggota{canManage ? ' — tekan Tambah untuk mengisi peran ini.' : '.'}
                </p>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {group.members.map((member) => (
                    <li
                      key={member.id}
                      className="grid grid-cols-1 items-center gap-2 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_170px_150px_140px_36px]"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                          {member.name}
                        </p>
                        <p className="truncate text-xs text-slate-500">{member.email}</p>
                      </div>
                      {canManage && !member.fromNodeGrant ? (
                        <SelectControl
                          aria-label={`Pindahkan peran ${member.name}`}
                          value={member.jobRole}
                          options={PROJECT_JOB_ROLES.map((jobRole) => ({
                            value: jobRole,
                            label: PROJECT_JOB_ROLE_LABELS[jobRole],
                          }))}
                          onValueChange={(value) =>
                            value &&
                            value !== member.jobRole &&
                            patchMember(member, { jobRole: value as ProjectJobRole })
                          }
                        />
                      ) : (
                        <span className="hidden sm:block" />
                      )}
                      {canManage && !member.fromNodeGrant ? (
                        <SelectControl
                          aria-label={`Hak akses ${member.name}`}
                          value={member.projectRole}
                          options={PROJECT_ROLES.map((projectRole) => ({
                            value: projectRole,
                            label: PROJECT_ROLE_LABELS[projectRole],
                          }))}
                          onValueChange={(value) =>
                            value &&
                            value !== member.projectRole &&
                            patchMember(member, { projectRole: value as ProjectRole })
                          }
                        />
                      ) : (
                        <span>
                          <Badge tone="info">{PROJECT_ROLE_LABELS[member.projectRole]}</Badge>
                        </span>
                      )}
                      {member.fromNodeGrant ? (
                        <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                          <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                          Akses node
                        </span>
                      ) : (
                        <span className="text-xs text-slate-500">Ditambahkan di project</span>
                      )}
                      {canManage && !member.fromNodeGrant ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Keluarkan ${member.name}`}
                          onClick={() => removeMember(member)}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </Button>
                      ) : (
                        <span />
                      )}
                    </li>
                  ))}
                  {group.invitations.map((invitation) => (
                    <InvitationRow key={invitation.id} invitation={invitation} />
                  ))}
                </ul>
              )}
            </section>
          ))
        )}

        {unassignedInvitations.length > 0 && !roleFilter && !onlyEmpty && (
          <section className="rounded-lg border border-slate-200 dark:border-slate-800">
            <header className="flex items-center gap-2 border-b border-inherit px-3 py-2">
              <UserPlus className="h-4 w-4 text-slate-400" aria-hidden />
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Undangan tanpa peran
              </h3>
            </header>
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {unassignedInvitations.map((invitation) => (
                <InvitationRow key={invitation.id} invitation={invitation} />
              ))}
            </ul>
          </section>
        )}
      </div>

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Tambah anggota"
        description="Anggota baru masuk sebagai Collaborator. Naikkan haknya setelah ditambahkan bila perlu."
        footer={
          <>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Batal
            </Button>
            <Button
              loading={busy}
              disabled={!form.userId && !canInvite}
              onClick={() => (form.userId ? addMember() : setInviting(typedSearch))}
            >
              {form.userId || !canInvite ? 'Tambahkan' : 'Undang lewat email'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {/*
            One control, not two. The dropdown *is* the search: it asks the API
            as you type and loads the next page as you scroll, so a thousand
            accounts cost the same as ten.
          */}
          <div>
            <span className="mb-1.5 block text-sm font-medium text-slate-700">User</span>
            <AsyncSelect
              queryKey={['project', projectId, 'member-candidates']}
              value={form.userId}
              selected={selectedCandidate}
              placeholder="Ketik nama atau email"
              emptyMessage="Tidak ada akun yang cocok."
              onSearchChange={setTypedSearch}
              onValueChange={(value) => {
                setForm((current) => ({ ...current, userId: value }));
                setSelectedCandidate(null);
              }}
              fetchPage={fetchCandidates}
              footer={(search) =>
                looksLikeEmail(search) ? (
                  <button
                    type="button"
                    onClick={() => setInviting(search)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-sky-700 hover:bg-sky-50"
                  >
                    <UserPlus className="h-4 w-4 shrink-0" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">
                      Undang <strong>{search}</strong> lewat email
                    </span>
                  </button>
                ) : null
              }
            />
            {canInvite ? (
              <p className="mt-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
                <strong>{typedSearch}</strong> belum punya akun. Tekan{' '}
                <strong>Undang lewat email</strong> untuk mengirimkan tautan pendaftaran.
              </p>
            ) : (
              <p className="mt-1.5 text-xs text-slate-500">
                Belum punya akun? Ketik alamat emailnya untuk mengundang.
              </p>
            )}
          </div>

          <SelectField
            label="Peran di project"
            value={form.jobRole}
            options={PROJECT_JOB_ROLES.map((jobRole) => ({
              value: jobRole,
              label: PROJECT_JOB_ROLE_LABELS[jobRole],
            }))}
            hint="Peran menjelaskan pekerjaannya, bukan hak aksesnya."
            onValueChange={(value) =>
              setForm((current) => ({ ...current, jobRole: value as ProjectJobRole }))
            }
          />
        </div>
      </Modal>

      {inviting && (
        <InviteMemberDialog
          projectId={projectId}
          email={inviting}
          initialJobRole={form.jobRole}
          onClose={() => setInviting(null)}
          onInvited={() => {
            setInviting(null);
            setAddOpen(false);
            // Re-read rather than push: the server decides what the list is.
            void load();
          }}
        />
      )}
    </Modal>
  );
}

/** A pending invitation, listed under the role it will join as. */
function InvitationRow({ invitation }: { invitation: InvitationView }) {
  return (
    <li className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm text-slate-600">
      <Clock className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{invitation.email}</span>
      <Badge tone={invitation.status === 'ACCEPTED' ? 'success' : 'warning'}>
        {INVITATION_STATUS_LABELS[invitation.status]}
      </Badge>
    </li>
  );
}
