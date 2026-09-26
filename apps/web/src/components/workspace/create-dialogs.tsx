'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  PROJECT_STAGES,
  PROJECT_STAGE_LABELS,
  createDocumentSchema,
  createProjectSchema,
  type DocumentTemplateSummary,
  type ProjectStage,
  type ProjectView,
  type WorkspaceDocumentSummary,
  type WorkspaceNode,
  type WorkspaceProjectSummary,
} from '@dtrace/shared';
import { ApiClientError, clientFetch } from '@/lib/api/client';
import { useInvalidateWorkspaceTree } from '@/lib/query/use-workspace-tree';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { SelectField, TextField, TextareaField } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { dynamicRoute } from '@/lib/utils/routes';

/** A code suggested from the name, so the field is rarely typed by hand. */
function suggestCode(name: string): string {
  return name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30);
}

export interface CreateProjectDialogProps {
  node: WorkspaceNode | null;
  onClose: () => void;
}

/** Creates a project inside a node the caller may create in. */
export function CreateProjectDialog({ node, onClose }: CreateProjectDialogProps) {
  const router = useRouter();
  const invalidateTree = useInvalidateWorkspaceTree();
  const [form, setForm] = useState({ name: '', code: '', description: '' });
  const [codeTouched, setCodeTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (node) {
      setForm({ name: '', code: '', description: '' });
      setCodeTouched(false);
      setError(null);
    }
  }, [node]);

  async function submit() {
    if (!node) return;
    setBusy(true);
    setError(null);

    const parsed = createProjectSchema.safeParse({
      nodeId: node.id,
      name: form.name,
      code: form.code || suggestCode(form.name),
      description: form.description || null,
      startsAt: null,
      goLiveAt: null,
    });

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Data belum lengkap');
      setBusy(false);
      return;
    }

    try {
      const result = await clientFetch<ProjectView>('/workspace/projects', {
        method: 'POST',
        body: parsed.data,
      });
      onClose();
      // The sidebar owns its tree, so it is told directly rather than left to
      // a `router.refresh()` racing the push below.
      invalidateTree();
      // Straight into the Project Space: an empty project is not a destination.
      router.push(dynamicRoute(`/workspace/project/${result.data.id}`));
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : 'Project gagal dibuat.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={node !== null}
      onClose={onClose}
      title="Project baru"
      description={node ? `Dibuat di ${node.name}. Kode harus unik di node ini.` : undefined}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Batal
          </Button>
          <Button loading={busy} onClick={submit}>
            Buat project
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
          placeholder="ESS-HR Additional PTK"
          onChange={(event) => {
            const name = event.target.value;
            setForm((current) => ({
              ...current,
              name,
              code: codeTouched ? current.code : suggestCode(name),
            }));
          }}
        />

        <TextField
          label="Kode"
          value={form.code}
          maxLength={30}
          placeholder="ESS_HR_PTK"
          hint="Dipakai sebagai identitas project di node ini."
          onChange={(event) => {
            setCodeTouched(true);
            setForm((current) => ({ ...current, code: event.target.value.toUpperCase() }));
          }}
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
      </div>
    </Modal>
  );
}

export interface CreateDocumentDialogProps {
  project: WorkspaceProjectSummary | null;
  /** Templates the caller may produce a document from. */
  templates: DocumentTemplateSummary[];
  /** Stage the dialog opens on, e.g. the column the "+" was clicked in. */
  defaultStage?: ProjectStage;
  onClose: () => void;
}

/**
 * Creates a document inside a project, optionally from a master template.
 *
 * The template is chosen here rather than after the fact because it decides
 * the document's whole shape: switching it later would mean reconciling
 * content that was entered against a different set of sections.
 */
export function CreateDocumentDialog({
  project,
  templates,
  defaultStage = 'PREPARE',
  onClose,
}: CreateDocumentDialogProps) {
  const router = useRouter();
  const invalidateTree = useInvalidateWorkspaceTree();
  const [form, setForm] = useState({ title: '', templateId: '', stage: defaultStage });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (project) {
      setForm({ title: '', templateId: '', stage: defaultStage });
      setError(null);
    }
  }, [project, defaultStage]);

  async function submit() {
    if (!project) return;
    setBusy(true);
    setError(null);

    const parsed = createDocumentSchema.safeParse({
      projectId: project.id,
      title: form.title,
      templateId: form.templateId || null,
      stage: form.stage,
    });

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Data belum lengkap');
      setBusy(false);
      return;
    }

    try {
      await clientFetch<WorkspaceDocumentSummary>('/workspace/documents', {
        method: 'POST',
        body: parsed.data,
      });
      onClose();
      invalidateTree();
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : 'Dokumen gagal dibuat.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={project !== null}
      onClose={onClose}
      title="Dokumen baru"
      description={project ? `Dibuat di project ${project.name}.` : undefined}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Batal
          </Button>
          <Button loading={busy} onClick={submit}>
            Buat dokumen
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <Alert tone="danger">{error}</Alert>}

        <TextField
          label="Judul dokumen"
          value={form.title}
          maxLength={160}
          placeholder="Kick Off Meeting Minutes"
          onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
        />

        <SelectField
          label="Dari template"
          value={form.templateId}
          placeholder="Tanpa template (dokumen kosong)"
          options={templates.map((template) => ({
            value: template.id,
            label: `${template.name} · v${template.version}`,
          }))}
          hint={
            templates.length === 0
              ? 'Belum ada master template aktif. Dokumen akan dibuat kosong.'
              : 'Template menentukan susunan section dokumen ini.'
          }
          onValueChange={(value) =>
            setForm((current) => ({ ...current, templateId: value }))
          }
        />

        <SelectField
          label="Tahapan"
          value={form.stage}
          options={PROJECT_STAGES.map((stage) => ({
            value: stage,
            label: PROJECT_STAGE_LABELS[stage],
          }))}
          onValueChange={(value) =>
            setForm((current) => ({ ...current, stage: value as ProjectStage }))
          }
        />
      </div>
    </Modal>
  );
}
