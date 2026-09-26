'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  PROJECT_STAGES,
  PROJECT_STAGE_LABELS,
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  updateProjectSchema,
  type ProjectStage,
  type ProjectStatus,
  type ProjectView,
} from '@dtrace/shared';
import { ApiClientError, clientFetch } from '@/lib/api/client';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { SelectField, TextField, TextareaField } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';

/** A date input hands back YYYY-MM-DD; the contract wants a datetime. */
const toInput = (iso: string | null) => (iso ? iso.slice(0, 10) : '');
const fromInput = (value: string) => (value ? `${value}T00:00:00.000Z` : null);

export interface EditProjectDialogProps {
  project: ProjectView;
  open: boolean;
  onClose: () => void;
}

/**
 * Editing a project's own details.
 *
 * Everything a person decides about the project itself, the code included. A
 * document refers to its project by id, so renaming the code breaks no link —
 * it is a label people quote in mail and in meetings, and the audit trail is
 * what connects the old one to the new. Uniqueness within the node is checked
 * server-side before the write.
 *
 * The **node** is deliberately absent. Moving a project between Apps moves
 * everyone's access to it along with it, which is a different act from
 * correcting a name and deserves its own deliberate screen.
 *
 * The payload carries only what actually changed. Sending the whole form back
 * would make every save look like an edit of every field in the audit trail,
 * and the trail is meant to answer what moved.
 */
export function EditProjectDialog({ project, open, onClose }: EditProjectDialogProps) {
  const router = useRouter();

  const [form, setForm] = useState({
    name: project.name,
    code: project.code,
    description: project.description ?? '',
    stage: project.stage,
    status: project.status,
    startsAt: toInput(project.startsAt),
    goLiveAt: toInput(project.goLiveAt),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reopening after a save elsewhere should show what is stored, not the
  // draft that was abandoned last time.
  useEffect(() => {
    if (!open) return;
    setForm({
      name: project.name,
      code: project.code,
      description: project.description ?? '',
      stage: project.stage,
      status: project.status,
      startsAt: toInput(project.startsAt),
      goLiveAt: toInput(project.goLiveAt),
    });
    setError(null);
  }, [open, project]);

  async function submit() {
    setBusy(true);
    setError(null);

    const startsAt = fromInput(form.startsAt);
    const goLiveAt = fromInput(form.goLiveAt);

    if (startsAt && goLiveAt && goLiveAt < startsAt) {
      setError('Target Go Live tidak boleh mendahului tanggal mulai.');
      setBusy(false);
      return;
    }

    // Only the differences. `undefined` is "leave it alone"; `null` is a real
    // value meaning "cleared", which is why the dates are compared explicitly.
    const changes: Record<string, unknown> = {};
    if (form.name.trim() !== project.name) changes['name'] = form.name.trim();
    if (form.code.trim() !== project.code) changes['code'] = form.code.trim();
    if ((form.description.trim() || null) !== project.description) {
      changes['description'] = form.description.trim() || null;
    }
    if (form.stage !== project.stage) changes['stage'] = form.stage;
    if (form.status !== project.status) changes['status'] = form.status;
    if (startsAt !== project.startsAt) changes['startsAt'] = startsAt;
    if (goLiveAt !== project.goLiveAt) changes['goLiveAt'] = goLiveAt;

    if (Object.keys(changes).length === 0) {
      onClose();
      setBusy(false);
      return;
    }

    const parsed = updateProjectSchema.safeParse(changes);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Data belum valid');
      setBusy(false);
      return;
    }

    try {
      await clientFetch<ProjectView>(`/workspace/projects/${project.id}`, {
        method: 'PATCH',
        body: parsed.data,
      });
      onClose();
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : 'Project gagal disimpan.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Ubah project"
      description={`Di ${project.node.name}. Memindahkan project antar node bukan bagian dari perubahan ini.`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Batal
          </Button>
          <Button loading={busy} onClick={submit}>
            Simpan
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <Alert tone="danger">{error}</Alert>}

        <TextField
          label="Nama project"
          value={form.name}
          maxLength={120}
          onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
        />

        <TextField
          label="Kode project"
          value={form.code}
          maxLength={30}
          hint="Harus unik di node ini. Orang mengutipnya di email dan rapat, jadi ubah seperlunya."
          onChange={(event) =>
            setForm((current) => ({ ...current, code: event.target.value.toUpperCase() }))
          }
        />

        <TextareaField
          label="Deskripsi"
          value={form.description}
          rows={2}
          maxLength={500}
          onChange={(event) =>
            setForm((current) => ({ ...current, description: event.target.value }))
          }
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="Tanggal mulai"
            type="date"
            value={form.startsAt}
            onChange={(event) =>
              setForm((current) => ({ ...current, startsAt: event.target.value }))
            }
          />
          <TextField
            label="Target Go Live"
            type="date"
            value={form.goLiveAt}
            onChange={(event) =>
              setForm((current) => ({ ...current, goLiveAt: event.target.value }))
            }
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            label="Tahapan"
            value={form.stage}
            options={PROJECT_STAGES.map((stage) => ({
              value: stage,
              label: PROJECT_STAGE_LABELS[stage],
            }))}
            hint="Tahapan yang dinyatakan, bukan yang dihitung dari dokumen."
            onValueChange={(value) =>
              setForm((current) => ({ ...current, stage: value as ProjectStage }))
            }
          />
          <SelectField
            label="Status project"
            value={form.status}
            options={PROJECT_STATUSES.map((status) => ({
              value: status,
              label: PROJECT_STATUS_LABELS[status],
            }))}
            onValueChange={(value) =>
              setForm((current) => ({ ...current, status: value as ProjectStatus }))
            }
          />
        </div>
      </div>
    </Modal>
  );
}
