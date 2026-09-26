'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  BUG_ENVIRONMENTS,
  BUG_ENVIRONMENT_LABELS,
  BUG_SEVERITIES,
  BUG_SEVERITY_LABELS,
  BUG_STATUSES,
  BUG_STATUS_LABELS,
  saveBugSchema,
  type BugEnvironment,
  type BugSeverity,
  type BugStatus,
  type BugView,
} from '@dtrace/shared';
import { ApiClientError, clientFetch } from '@/lib/api/client';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { SelectField, TextField, TextareaField } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { useLocalTimeZone } from '@/lib/utils/use-local-time-zone';
import { BUG_STATUS_STYLE, dayIn, formatDay, instantDay, storedDay } from './bug-style';

/**
 * The bug under the cursor, held as strings — a half-typed date is a string
 * and only a whole one is a date. `toBody()` is the one place it converts.
 */
interface Form {
  title: string;
  description: string;
  module: string;
  environment: BugEnvironment;
  severity: BugSeverity;
  status: BugStatus;
  developerId: string;
  qaId: string;
  foundAt: string;
  fixEta: string;
}

type FieldErrors = Partial<Record<keyof Form, string>>;

function toForm(bug: BugView | null, environment: BugEnvironment, today: string): Form {
  return {
    title: bug?.title ?? '',
    description: bug?.description ?? '',
    module: bug?.module ?? '',
    environment: bug?.environment ?? environment,
    severity: bug?.severity ?? 'MEDIUM',
    status: bug?.status ?? 'OPEN',
    developerId: bug?.developerId ?? '',
    qaId: bug?.qaId ?? '',
    // A new bug was found today unless somebody says otherwise — the common
    // case is reporting it the moment it is seen.
    foundAt: bug ? storedDay(bug.foundAt) : today,
    fixEta: bug?.fixEta ? storedDay(bug.fixEta) : '',
  };
}

function toBody(form: Form) {
  return {
    title: form.title.trim(),
    description: form.description.trim() || null,
    module: form.module.trim() || null,
    environment: form.environment,
    severity: form.severity,
    status: form.status,
    developerId: form.developerId || null,
    qaId: form.qaId || null,
    foundAt: form.foundAt ? `${form.foundAt}T00:00:00.000Z` : '',
    fixEta: form.fixEta ? `${form.fixEta}T00:00:00.000Z` : null,
  };
}

export interface BugDialogProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  /** The bug being changed, or null to report a new one. */
  bug: BugView | null;
  /** Where a new bug starts: the environment the list is showing. */
  environment: BugEnvironment;
  members: { userId: string; name: string }[];
  /** Modules already used in this project, offered as suggestions. */
  modules: string[];
  /** False opens the bug read-only. */
  canEdit: boolean;
}

/**
 * Reporting a bug, and changing one.
 *
 * A dialog rather than an editable row: the row sits beside a timeline, and a
 * bug's description — the steps to reproduce it — needs room a table cell
 * cannot give.
 */
export function BugDialog({
  open,
  onClose,
  projectId,
  bug,
  environment,
  members,
  modules,
  canEdit,
}: BugDialogProps) {
  const router = useRouter();
  const timeZone = useLocalTimeZone();

  const [form, setForm] = useState<Form>(() => toForm(bug, environment, dayIn(new Date(), timeZone)));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Reopening shows what is stored, not the draft abandoned last time.
  useEffect(() => {
    if (!open) return;
    setForm(toForm(bug, environment, dayIn(new Date(), timeZone)));
    setErrors({});
    setError(null);
  }, [open, bug, environment, timeZone]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  async function submit() {
    setError(null);

    // The same schema the API validates with, so a missing title is answered
    // on its field rather than as a 400 the dialog cannot place.
    const parsed = saveBugSchema.safeParse(toBody(form));
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as keyof Form | undefined;
        if (field && !next[field]) next[field] = issue.message;
      }
      if (!form.foundAt) next.foundAt = 'Tanggal ditemukan wajib diisi';
      setErrors(next);
      return;
    }

    setBusy(true);
    try {
      await (bug
        ? clientFetch(`/workspace/bugs/${bug.id}`, { method: 'PUT', body: parsed.data })
        : clientFetch(`/workspace/projects/${projectId}/bugs`, { method: 'POST', body: parsed.data }));
      onClose();
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiClientError) {
        const fieldErrors = caught.fieldErrors;
        setErrors(fieldErrors as FieldErrors);
        if (Object.keys(fieldErrors).length === 0) setError(caught.message);
      } else {
        setError('Bug gagal disimpan.');
      }
    } finally {
      setBusy(false);
    }
  }

  // Somebody assigned before they left the team still shows by name, rather
  // than the control going blank and looking unassigned.
  const people = (current: string, name: string | null) => {
    const options = members.map((member) => ({ value: member.userId, label: member.name }));
    if (current && !members.some((member) => member.userId === current)) {
      options.unshift({ value: current, label: `${name ?? 'Pengguna lain'} (bukan anggota tim)` });
    }
    return options;
  };

  const readOnly = !canEdit;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={bug ? `${bug.code} — ${bug.title}` : 'Tambah bug'}
      description={
        bug
          ? [
              `Dilaporkan${bug.reportedByName ? ` oleh ${bug.reportedByName}` : ''} ${formatDay(instantDay(bug.createdAt, timeZone))}`,
              bug.readyForTestAt && `diserahkan ke QA ${formatDay(instantDay(bug.readyForTestAt, timeZone))}`,
              bug.resolvedAt && `selesai ${formatDay(instantDay(bug.resolvedAt, timeZone))}`,
            ]
              .filter(Boolean)
              .join(' · ')
          : 'Catat di environment mana bug ditemukan dan siapa yang memperbaikinya.'
      }
      footer={
        readOnly ? (
          <Button variant="outline" onClick={onClose}>
            Tutup
          </Button>
        ) : (
          <>
            <Button variant="outline" onClick={onClose} disabled={busy}>
              Batal
            </Button>
            <Button loading={busy} onClick={() => void submit()}>
              {bug ? 'Simpan' : 'Tambah bug'}
            </Button>
          </>
        )
      }
    >
      <div className="space-y-3">
        {error && <Alert tone="danger">{error}</Alert>}

        <TextField
          label="Judul"
          name="bug-title"
          value={form.title}
          maxLength={200}
          disabled={readOnly}
          error={errors.title}
          placeholder="Contoh: Export Excel menghasilkan file kosong"
          onChange={(event) => set('title', event.target.value)}
        />

        <TextareaField
          label="Deskripsi"
          name="bug-description"
          rows={4}
          value={form.description}
          maxLength={4000}
          disabled={readOnly}
          error={errors.description}
          placeholder="Langkah reproduksi, hasil yang diharapkan, dan hasil aktual."
          onChange={(event) => set('description', event.target.value)}
        />

        <div className="grid gap-3 sm:grid-cols-3">
          <SelectField
            label="Environment"
            name="bug-environment"
            value={form.environment}
            clearable={false}
            disabled={readOnly}
            error={errors.environment}
            options={BUG_ENVIRONMENTS.map((value) => ({
              value,
              label: BUG_ENVIRONMENT_LABELS[value],
            }))}
            onValueChange={(value) => value && set('environment', value as BugEnvironment)}
          />
          <SelectField
            label="Severity"
            name="bug-severity"
            value={form.severity}
            clearable={false}
            disabled={readOnly}
            error={errors.severity}
            options={BUG_SEVERITIES.map((value) => ({ value, label: BUG_SEVERITY_LABELS[value] }))}
            onValueChange={(value) => value && set('severity', value as BugSeverity)}
          />
          <SelectField
            label="Status"
            name="bug-status"
            value={form.status}
            clearable={false}
            disabled={readOnly}
            error={errors.status}
            options={BUG_STATUSES.map((value) => ({
              value,
              label: BUG_STATUS_LABELS[value],
              dot: BUG_STATUS_STYLE[value].dot,
            }))}
            onValueChange={(value) => value && set('status', value as BugStatus)}
          />
        </div>

        <TextField
          label="Modul"
          name="bug-module"
          value={form.module}
          maxLength={80}
          disabled={readOnly}
          error={errors.module}
          list="bug-module-suggestions"
          placeholder="Contoh: Reporting"
          hint="Ketik bebas, atau pilih modul yang sudah dipakai di project ini."
          onChange={(event) => set('module', event.target.value)}
        />
        <datalist id="bug-module-suggestions">
          {modules.map((module) => (
            <option key={module} value={module} />
          ))}
        </datalist>

        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            label="Developer"
            name="bug-developer"
            placeholder="Belum ditugaskan"
            value={form.developerId}
            disabled={readOnly}
            error={errors.developerId}
            options={people(form.developerId, bug?.developerName ?? null)}
            emptyMessage="Belum ada anggota tim di project ini."
            onValueChange={(value) => set('developerId', value)}
          />
          <SelectField
            label="QA PIC"
            name="bug-qa"
            placeholder="Belum ditugaskan"
            value={form.qaId}
            disabled={readOnly}
            error={errors.qaId}
            options={people(form.qaId, bug?.qaName ?? null)}
            emptyMessage="Belum ada anggota tim di project ini."
            onValueChange={(value) => set('qaId', value)}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="Tanggal ditemukan"
            name="bug-found-at"
            type="date"
            value={form.foundAt}
            disabled={readOnly}
            error={errors.foundAt}
            onChange={(event) => set('foundAt', event.target.value)}
          />
          <TextField
            label="Target perbaikan (Fix ETA)"
            name="bug-fix-eta"
            type="date"
            value={form.fixEta}
            min={form.foundAt || undefined}
            disabled={readOnly}
            error={errors.fixEta}
            onChange={(event) => set('fixEta', event.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
}
