'use client';

import { useMutation } from '@tanstack/react-query';
import {
  Eye,
  FileText,
  Check,
  ClipboardCheck,
  Copy,
  Download,
  FolderPlus,
  ListPlus,
  Plus,
  Paperclip,
  Save,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  TEST_CAPTURES_PER_ROW,
  TEST_ENVIRONMENTS,
  TEST_ENVIRONMENT_LABELS,
  TEST_RESULTS,
  TEST_RESULT_LABELS,
  TEST_SCRIPT_KIND_LABELS,
  TEST_SCRIPT_STATUS_LABELS,
  TEST_TYPES,
  TEST_TYPE_LABELS,
  saveTestScriptSchema,
  sectionLetter,
  summarizeTestScript,
  testCaptureUrl,
  type TestCaptureView,
  type TestEnvironment,
  type TestModuleView,
  type TestResult,
  type TestScenarioView,
  type TestSectionView,
  type TestScriptView,
  type TestType,
} from '@dtrace/shared';
import { ApiClientError, clientFetch } from '@/lib/api/client';
import { formatDateTime } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { SelectField, TextField } from '@/components/ui/field';
import { toast } from '@/components/ui/sonner';

/** The grid's own input: sized for a dense table, not for a form. */
const CELL_INPUT =
  'w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 outline-none focus:border-sky-500 disabled:bg-slate-50 disabled:text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:disabled:bg-slate-950';

/** Grows with what is typed, so a long expected output never hides behind a scrollbar. */
const CELL_TEXTAREA = cn(CELL_INPUT, 'min-h-8 resize-y [field-sizing:content]');

const RESULT_TONE: Record<TestResult, { on: string; bar: string }> = {
  OK: { on: 'bg-emerald-600 text-white ring-emerald-600', bar: 'bg-emerald-500' },
  NOK: { on: 'bg-red-600 text-white ring-red-600', bar: 'bg-red-500' },
  PENDING: { on: 'bg-amber-500 text-white ring-amber-500', bar: 'bg-amber-400' },
};

type ResultFilter = TestResult | '';

const newId = () => crypto.randomUUID();

function flattenSections(
  sections: TestSectionView[],
  prefix = '',
  depth = 0,
): { section: TestSectionView; label: string; depth: number }[] {
  return sections.flatMap((section, index) => {
    const label = prefix ? `${prefix}.${index + 1}` : sectionLetter(index);
    return [
      { section, label, depth },
      ...flattenSections(section.children, label, depth + 1),
    ];
  });
}

function blankRow(): TestScenarioView {
  return {
    id: newId(),
    role: '',
    type: 'POSITIVE',
    activity: '',
    input: '',
    expectedOutput: '',
    result: 'PENDING',
    notes: '',
    tester: '',
    paraf: false,
    parafByName: null,
    parafAt: null,
    captureIds: [],
  };
}

export interface TestScriptEditorProps {
  projectId: string;
  projectName: string;
  script: TestScriptView;
  canEdit: boolean;
}

/**
 * A SIT or UAT script: modules, their sub-sections, and the scenarios in each.
 *
 * Edited **in place, whole**, and saved as one document. That is how a tester
 * works — down a column of results, then save — and it is why the save carries
 * the version it loaded: two testers with the same script open would otherwise
 * each overwrite the other's column.
 *
 * Type and Result are pill toggles rather than the app's dropdown. They are the
 * two cells a tester touches on every row, with two and three values, and a
 * searchable combobox per cell would cost a click and a popup for each of what
 * is otherwise one click.
 */
export function TestScriptEditor({ projectId, projectName, script, canEdit }: TestScriptEditorProps) {
  const kindSlug = script.kind.toLowerCase();

  const [appName, setAppName] = useState(script.appName);
  const [version, setVersion] = useState(script.version);
  const [testDate, setTestDate] = useState(script.testDate ?? '');
  const [environment, setEnvironment] = useState<TestEnvironment>(script.environment);
  const [modules, setModules] = useState<TestModuleView[]>(script.modules);
  const [captures, setCaptures] = useState<Record<string, TestCaptureView>>(() =>
    Object.fromEntries(script.captures.map((capture) => [capture.id, capture])),
  );

  /** What the server last confirmed — the guard sent with the next save. */
  const [saved, setSaved] = useState(script);
  const [dirty, setDirty] = useState(false);
  const [filter, setFilter] = useState<ResultFilter>('');
  const [exporting, setExporting] = useState(false);

  // A tester's afternoon of results must not vanish to a stray tab close.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const summary = useMemo(() => summarizeTestScript(modules), [modules]);

  function touch(next: TestModuleView[]) {
    setModules(next);
    setDirty(true);
  }

  /* ----------------------------- structure ------------------------------ */

  function updateModule(mi: number, patch: Partial<TestModuleView>) {
    touch(modules.map((module, i) => (i === mi ? { ...module, ...patch } : module)));
  }

  function updateSection(mi: number, sectionId: string, patch: Partial<TestSectionView>) {
    const currentModule = modules[mi]!;
    const update = (sections: TestSectionView[]): TestSectionView[] =>
      sections.map((section) =>
        section.id === sectionId
          ? { ...section, ...patch }
          : { ...section, children: update(section.children) },
      );
    updateModule(mi, {
      sections: update(currentModule.sections),
    });
  }

  function findSection(sections: TestSectionView[], id: string): TestSectionView | undefined {
    for (const section of sections) {
      if (section.id === id) return section;
      const found = findSection(section.children, id);
      if (found) return found;
    }
    return undefined;
  }

  function updateRow(mi: number, sectionId: string, ri: number, patch: Partial<TestScenarioView>) {
    const section = findSection(modules[mi]!.sections, sectionId)!;
    updateSection(mi, sectionId, {
      rows: section.rows.map((row, i) => (i === ri ? { ...row, ...patch } : row)),
    });
  }

  function addModule() {
    touch([
      ...modules,
      {
        id: newId(),
        name: `Modul ${modules.length + 1}`,
        sections: [{ id: newId(), name: 'Bagian baru', rows: [blankRow()], children: [] }],
      },
    ]);
  }

  function removeModule(mi: number) {
    const currentModule = modules[mi]!;
    const count = summarizeTestScript([currentModule]).total;
    if (count > 0 && !window.confirm(`Hapus "${currentModule.name || 'modul ini'}" beserta ${count} skenarionya?`)) {
      return;
    }
    touch(modules.filter((_, i) => i !== mi));
  }

  function addSection(mi: number) {
    const currentModule = modules[mi]!;
    updateModule(mi, {
      sections: [...currentModule.sections, { id: newId(), name: 'Bagian baru', rows: [blankRow()], children: [] }],
    });
  }

  function removeSection(mi: number, sectionId: string) {
    const section = findSection(modules[mi]!.sections, sectionId)!;
    if (
      section.rows.length > 0 &&
      !window.confirm(`Hapus "${section.name || 'sub-bagian ini'}" beserta ${section.rows.length} skenarionya?`)
    ) {
      return;
    }
    const remove = (sections: TestSectionView[]): TestSectionView[] =>
      sections
        .filter((item) => item.id !== sectionId)
        .map((item) => ({ ...item, children: remove(item.children) }));
    updateModule(mi, { sections: remove(modules[mi]!.sections) });
  }

  function addChildSection(mi: number, parentId: string) {
    const parent = findSection(modules[mi]!.sections, parentId)!;
    updateSection(mi, parentId, {
      children: [...parent.children, { id: newId(), name: 'Sub-bagian baru', rows: [blankRow()], children: [] }],
    });
  }

  function addRow(mi: number, sectionId: string) {
    const section = findSection(modules[mi]!.sections, sectionId)!;
    // Role and tester carry over: consecutive scenarios are nearly always run
    // by the same person acting as the same role.
    const last = section.rows.at(-1);
    updateSection(mi, sectionId, {
      rows: [...section.rows, { ...blankRow(), role: last?.role ?? '', tester: last?.tester ?? '' }],
    });
  }

  /** Copies a scenario in directly below itself, result and evidence reset. */
  function duplicateRow(mi: number, sectionId: string, ri: number) {
    const rows = [...findSection(modules[mi]!.sections, sectionId)!.rows];
    const source = rows[ri]!;
    rows.splice(ri + 1, 0, {
      ...source,
      id: newId(),
      result: 'PENDING',
      paraf: false,
      parafByName: null,
      parafAt: null,
      captureIds: [],
    });
    updateSection(mi, sectionId, { rows });
  }

  function removeRow(mi: number, sectionId: string, ri: number) {
    const section = findSection(modules[mi]!.sections, sectionId)!;
    updateSection(mi, sectionId, { rows: section.rows.filter((_, i) => i !== ri) });
  }

  /* -------------------------------- save -------------------------------- */

  const save = useMutation({
    mutationFn: async (submit: boolean) => {
      const parsed = saveTestScriptSchema.safeParse({
        appName,
        version,
        testDate: testDate || null,
        environment,
        modules,
        submit,
        expectedUpdatedAt: saved.updatedAt,
      });
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message ?? 'Test script belum valid');
      }

      const result = await clientFetch<TestScriptView>(
        `/workspace/projects/${projectId}/test-scripts/${kindSlug}`,
        { method: 'PUT', body: parsed.data },
      );
      return result.data;
    },
    onSuccess: (next, submit) => {
      setSaved(next);
      // The server's copy carries the paraf stamps, so it replaces ours.
      setModules(next.modules);
      setCaptures((current) => ({
        ...current,
        ...Object.fromEntries(next.captures.map((capture) => [capture.id, capture])),
      }));
      setDirty(false);
      toast.success(submit ? 'Hasil testing tersubmit.' : 'Draft tersimpan.');
    },
  });

  function submit() {
    if (summary.pending > 0) {
      toast.error(`Masih ada ${summary.pending} skenario Pending.`);
      setFilter('PENDING');
      return;
    }
    save.mutate(true);
  }

  async function exportExcel() {
    setExporting(true);
    try {
      const { exportTestScriptToExcel } = await import('./test-script-export');
      await exportTestScriptToExcel({
        projectName,
        kind: script.kind,
        appName,
        version,
        testDate: testDate || null,
        environment,
        status: saved.status,
        submittedAt: saved.submittedAt,
        submittedByName: saved.submittedByName,
        modules,
        captures,
        origin: window.location.origin,
      });
    } catch {
      toast.error('Export gagal. Coba lagi.');
    } finally {
      setExporting(false);
    }
  }

  const error = save.error
    ? save.error instanceof ApiClientError
      ? (save.error.details?.[0]?.message ?? save.error.message)
      : save.error.message
    : null;

  const readOnly = !canEdit;

  return (
    <div className="space-y-4">
      {error && <Alert tone="danger">{error}</Alert>}

      <Card>
        <CardHeader
          title={TEST_SCRIPT_KIND_LABELS[script.kind]}
          description={`${projectName} — skenario pengujian dan hasilnya.`}
          icon={<ClipboardCheck className="h-4 w-4" aria-hidden />}
          tinted
          action={
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={saved.status === 'SUBMITTED' ? 'success' : 'neutral'}>
                {TEST_SCRIPT_STATUS_LABELS[saved.status]}
              </Badge>
              {saved.status === 'SUBMITTED' && saved.submittedAt && (
                <span className="text-xs text-slate-500">
                  oleh {saved.submittedByName ?? '—'} · {formatDateTime(saved.submittedAt)}
                </span>
              )}
              {dirty && <Badge tone="warning">Belum disimpan</Badge>}
              <Button
                variant="outline"
                leftIcon={<Download className="h-4 w-4" aria-hidden />}
                loading={exporting}
                disabled={exporting}
                onClick={() => void exportExcel()}
              >
                Export Excel
              </Button>
            </div>
          }
        />

        <div className="grid gap-4 px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
          <TextField
            label="Nama Aplikasi"
            name="appName"
            value={appName}
            disabled={readOnly}
            onChange={(event) => {
              setAppName(event.target.value);
              setDirty(true);
            }}
          />
          <TextField
            label="Versi / Release"
            name="version"
            placeholder="1.0.0"
            value={version}
            disabled={readOnly}
            onChange={(event) => {
              setVersion(event.target.value);
              setDirty(true);
            }}
          />
          <TextField
            label="Tanggal Testing"
            name="testDate"
            type="date"
            value={testDate}
            disabled={readOnly}
            onChange={(event) => {
              setTestDate(event.target.value);
              setDirty(true);
            }}
          />
          <SelectField
            label="Environment"
            name="environment"
            value={environment}
            disabled={readOnly}
            options={TEST_ENVIRONMENTS.map((value) => ({ value, label: TEST_ENVIRONMENT_LABELS[value] }))}
            onValueChange={(value) => {
              if (!value) return;
              setEnvironment(value as TestEnvironment);
              setDirty(true);
            }}
          />
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Total skenario" value={summary.total} />
        <Stat label="OK" value={summary.ok} tone="text-emerald-700 dark:text-emerald-400" />
        <Stat label="NOK" value={summary.nok} tone="text-red-700 dark:text-red-400" />
        <Stat label="Pending" value={summary.pending} tone="text-amber-700 dark:text-amber-400" />
        <Stat label="Pass rate" value={`${summary.passRate}%`} tone="text-sky-700 dark:text-sky-400" />
      </div>

      <div className="flex h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800" aria-hidden>
        {summary.total > 0 && (
          <>
            <i className={cn('block h-full', RESULT_TONE.OK.bar)} style={{ width: `${(summary.ok / summary.total) * 100}%` }} />
            <i className={cn('block h-full', RESULT_TONE.NOK.bar)} style={{ width: `${(summary.nok / summary.total) * 100}%` }} />
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-500">Filter hasil:</span>
        {(['', ...TEST_RESULTS] as ResultFilter[]).map((value) => (
          <button
            key={value || 'all'}
            type="button"
            onClick={() => setFilter(value)}
            className={cn(
              'rounded-full px-3 py-1 text-xs ring-1 ring-slate-300 transition-colors dark:ring-slate-700',
              filter === value
                ? 'bg-sky-600 text-white ring-sky-600'
                : 'bg-white text-slate-700 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300',
            )}
          >
            {value ? TEST_RESULT_LABELS[value] : 'Semua'}
            {value && (
              <span className="ml-1 opacity-70">
                {value === 'OK' ? summary.ok : value === 'NOK' ? summary.nok : summary.pending}
              </span>
            )}
          </button>
        ))}
        <span className="flex-1" />
        {canEdit && (
          <Button
            variant="outline"
            leftIcon={<FolderPlus className="h-4 w-4" aria-hidden />}
            onClick={addModule}
          >
            Tambah Modul
          </Button>
        )}
      </div>

      {modules.length === 0 && (
        <Card className="px-5 py-10 text-center text-sm text-slate-500">
          Belum ada modul. {canEdit && 'Mulai dengan “Tambah Modul”.'}
        </Card>
      )}

      {modules.length > 0 && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1250px] border-collapse text-sm">
              <thead>
                <tr className="bg-sky-700 text-left text-xs font-semibold text-white">
                  <th className="w-10 px-2 py-2.5 text-center">No</th>
                  <th className="w-28 px-2 py-2.5">Role</th>
                  <th className="w-28 px-2 py-2.5">Type Test</th>
                  <th className="px-2 py-2.5">Activity</th>
                  <th className="px-2 py-2.5">Input</th>
                  <th className="px-2 py-2.5">Expected Output</th>
                  <th className="w-28 px-2 py-2.5">Result</th>
                  <th className="w-40 px-2 py-2.5">Notes</th>
                  <th className="w-24 px-2 py-2.5">Paraf</th>
                  <th className="w-28 px-2 py-2.5">Tester</th>
                  <th className="w-48 px-2 py-2.5">Evidence</th>
                  {canEdit && <th className="w-16 px-2 py-2.5" />}
                </tr>
              </thead>
              {modules.map((module, mi) => (
                <tbody key={module.id}>
                  <tr className="border-t border-sky-200 bg-sky-100 dark:border-sky-900 dark:bg-sky-950/70">
                    <td className="px-2 py-2 text-center font-semibold text-sky-950 dark:text-sky-100">{mi + 1}</td>
                    <td colSpan={canEdit ? 11 : 10} className="px-2 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <input
                          aria-label="Nama modul"
                          className={cn(CELL_INPUT, 'max-w-md border-transparent bg-transparent text-sm font-semibold')}
                          value={module.name}
                          placeholder="Nama modul"
                          disabled={readOnly}
                          onChange={(event) => updateModule(mi, { name: event.target.value })}
                        />
                        {canEdit && <div className="flex items-center gap-1">
                          <Button variant="ghost" size="sm" leftIcon={<ListPlus className="h-3.5 w-3.5" aria-hidden />} onClick={() => addSection(mi)}>
                            Tambah Bagian
                          </Button>
                          <Button variant="ghost" size="icon-sm" aria-label={`Hapus ${module.name || 'modul'}`} title="Hapus modul" onClick={() => removeModule(mi)}>
                            <Trash2 className="h-3.5 w-3.5 text-red-500" aria-hidden />
                          </Button>
                        </div>}
                      </div>
                    </td>
                  </tr>

                  {flattenSections(module.sections).map(({ section, label, depth }) => (
                    <Fragment key={section.id}>
                      <tr className="border-t border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/60">
                        <td className="px-2 py-2 text-center text-xs font-medium text-slate-500">{label}</td>
                        <td colSpan={canEdit ? 11 : 10} className="px-2 py-2">
                          <div className="flex items-center justify-between gap-2" style={{ paddingLeft: `${depth * 24}px` }}>
                            <input
                              aria-label="Nama bagian"
                              className={cn(CELL_INPUT, 'max-w-md border-transparent bg-transparent text-sm font-medium')}
                              value={section.name}
                              placeholder="Nama bagian"
                              disabled={readOnly}
                              onChange={(event) => updateSection(mi, section.id, { name: event.target.value })}
                            />
                            {canEdit && <div className="flex items-center gap-1">
                              <Button variant="ghost" size="sm" leftIcon={<ListPlus className="h-3.5 w-3.5" aria-hidden />} onClick={() => addChildSection(mi, section.id)}>
                                Tambah Turunan
                              </Button>
                              <Button variant="ghost" size="icon-sm" aria-label={`Hapus ${section.name || 'bagian'}`} title="Hapus bagian" onClick={() => removeSection(mi, section.id)}>
                                <X className="h-3.5 w-3.5" aria-hidden />
                              </Button>
                            </div>}
                          </div>
                        </td>
                      </tr>
                      {section.rows.map((row, ri) =>
                        filter && row.result !== filter ? null : (
                          <ScenarioRow
                            key={row.id}
                            number={ri + 1}
                            row={row}
                            readOnly={readOnly}
                            captures={captures}
                            uploadPath={`/workspace/projects/${projectId}/test-scripts/${kindSlug}/captures`}
                            onChange={(patch) => updateRow(mi, section.id, ri, patch)}
                            onUploaded={(capture) => setCaptures((current) => ({ ...current, [capture.id]: capture }))}
                            onDuplicate={() => duplicateRow(mi, section.id, ri)}
                            onRemove={() => removeRow(mi, section.id, ri)}
                          />
                        ),
                      )}
                      {canEdit && (
                        <tr className="border-t border-slate-100 dark:border-slate-800">
                          <td />
                          <td colSpan={canEdit ? 11 : 10} className="px-2 py-1.5" style={{ paddingLeft: `${16 + depth * 24}px` }}>
                            <Button variant="ghost" size="sm" leftIcon={<Plus className="h-3.5 w-3.5" aria-hidden />} onClick={() => addRow(mi, section.id)}>
                              Tambah Skenario
                            </Button>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        </Card>
      )}

      {canEdit && (
        // Sticky, because the grid is long and the save is the one thing a
        // tester must not have to scroll back up to find.
        <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-slate-50/95 px-1 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
          {saved.updatedAt && (
            <span className="mr-auto text-xs text-slate-500">
              Terakhir disimpan {formatDateTime(saved.updatedAt)}
            </span>
          )}
          <Button
            variant="outline"
            leftIcon={<Save className="h-4 w-4" aria-hidden />}
            loading={save.isPending && save.variables === false}
            disabled={save.isPending}
            onClick={() => save.mutate(false)}
          >
            Simpan Draft
          </Button>
          <Button
            leftIcon={<Send className="h-4 w-4" aria-hidden />}
            loading={save.isPending && save.variables === true}
            disabled={save.isPending || summary.total === 0}
            onClick={submit}
          >
            Submit Hasil Testing
          </Button>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 dark:border-slate-800 dark:bg-slate-900">
      <p className={cn('text-xl font-semibold text-slate-900 dark:text-slate-100', tone)}>{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}

interface ScenarioRowProps {
  number: number;
  row: TestScenarioView;
  readOnly: boolean;
  captures: Record<string, TestCaptureView>;
  uploadPath: string;
  onChange: (patch: Partial<TestScenarioView>) => void;
  onUploaded: (capture: TestCaptureView) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}

function ScenarioRow({
  number,
  row,
  readOnly,
  captures,
  uploadPath,
  onChange,
  onUploaded,
  onDuplicate,
  onRemove,
}: ScenarioRowProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    const room = TEST_CAPTURES_PER_ROW - row.captureIds.length;
    const picked = Array.from(files).slice(0, room);
    setUploading(true);
    const added: string[] = [];
    try {
      for (const file of picked) {
        const form = new FormData();
        form.append('file', file);
        const result = await clientFetch<TestCaptureView>(uploadPath, { method: 'POST', body: form });
        onUploaded(result.data);
        added.push(result.data.id);
      }
    } catch (caught) {
      toast.error(
        caught instanceof ApiClientError
          ? (caught.details?.[0]?.message ?? caught.message)
          : 'Evidence gagal diunggah.',
      );
    } finally {
      // Whatever made it up before a failure is kept rather than thrown away.
      if (added.length > 0) onChange({ captureIds: [...row.captureIds, ...added] });
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const text = (key: 'activity' | 'input' | 'expectedOutput' | 'notes', label: string) => (
    <textarea
      aria-label={label}
      className={CELL_TEXTAREA}
      rows={1}
      value={row[key]}
      disabled={readOnly}
      onChange={(event) => onChange({ [key]: event.target.value })}
    />
  );

  return (
    <tr className="border-t border-slate-100 align-top dark:border-slate-800">
      <td className="px-2 py-2 pt-3 text-xs text-slate-500">{number}</td>
      <td className="px-2 py-2">
        <input
          aria-label="Role"
          className={CELL_INPUT}
          value={row.role}
          disabled={readOnly}
          onChange={(event) => onChange({ role: event.target.value })}
        />
      </td>
      <td className="px-2 py-2">
        <select
          aria-label="Type test"
          className={CELL_INPUT}
          value={row.type}
          disabled={readOnly}
          onChange={(event) => onChange({ type: event.target.value as TestType })}
        >
          {TEST_TYPES.map((value) => (
            <option key={value} value={value}>{TEST_TYPE_LABELS[value]}</option>
          ))}
        </select>
      </td>
      <td className="min-w-52 px-2 py-2">{text('activity', 'Activity')}</td>
      <td className="min-w-40 px-2 py-2">{text('input', 'Input')}</td>
      <td className="min-w-52 px-2 py-2">{text('expectedOutput', 'Expected output')}</td>
      <td className="px-2 py-2">
        <select
          aria-label="Result"
          className={CELL_INPUT}
          value={row.result}
          disabled={readOnly}
          onChange={(event) => onChange({ result: event.target.value as TestResult })}
        >
          {TEST_RESULTS.map((value) => (
            <option key={value} value={value}>{TEST_RESULT_LABELS[value]}</option>
          ))}
        </select>
      </td>
      <td className="px-2 py-2">{text('notes', 'Notes')}</td>
      <td className="px-2 py-2">
        <button
          type="button"
          disabled={readOnly}
          title={
            row.paraf && row.parafByName
              ? `Diparaf ${row.parafByName}${row.parafAt ? ` · ${formatDateTime(row.parafAt)}` : ''}`
              : row.paraf
                ? 'Diparaf atas nama Anda saat disimpan'
                : 'Paraf baris ini'
          }
          onClick={() => onChange({ paraf: !row.paraf })}
          className={cn(
            'inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-1 text-xs',
            row.paraf
              ? 'border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300'
              : 'border-dashed border-slate-300 text-sky-700 hover:bg-slate-50 dark:border-slate-700 dark:text-sky-400',
            readOnly && 'cursor-default',
          )}
        >
          {row.paraf && <Check className="h-3 w-3" aria-hidden />}
          Paraf
        </button>
        {row.paraf && row.parafByName && (
          <p className="mt-1 truncate text-[11px] text-slate-500" title={row.parafByName}>
            {row.parafByName}
          </p>
        )}
      </td>
      <td className="px-2 py-2">
        <input
          aria-label="Tester"
          className={CELL_INPUT}
          value={row.tester}
          disabled={readOnly}
          onChange={(event) => onChange({ tester: event.target.value })}
        />
      </td>
      <td className="px-2 py-2">
        <div className="flex flex-wrap items-center gap-1">
          {row.captureIds.map((id) => {
            const capture = captures[id];
            return (
              <span key={id} className="group relative flex max-w-40 items-center gap-1 rounded border border-slate-200 bg-white px-1.5 py-1 dark:border-slate-700 dark:bg-slate-900">
                {capture?.mimeType.startsWith('image/') ? (
                  // eslint-disable-next-line @next/next/no-img-element -- authenticated BFF URL
                  <img src={testCaptureUrl(id)} alt="" className="h-7 w-9 shrink-0 rounded object-cover" />
                ) : (
                  <FileText className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
                )}
                <span className="min-w-0 flex-1 truncate text-[11px]" title={capture?.fileName}>
                  {capture?.fileName ?? 'Evidence'}
                </span>
                <a href={testCaptureUrl(id)} target="_blank" rel="noopener noreferrer" aria-label="Lihat evidence" title="Lihat">
                  <Eye className="h-3.5 w-3.5 text-sky-600" aria-hidden />
                </a>
                <a href={testCaptureUrl(id, true)} aria-label="Unduh evidence" title="Unduh">
                  <Download className="h-3.5 w-3.5 text-sky-600" aria-hidden />
                </a>
                {!readOnly && (
                  <button
                    type="button"
                    aria-label="Lepas capture"
                    className="absolute -right-1.5 -top-1.5 hidden h-4 w-4 items-center justify-center rounded-full bg-slate-700 text-white group-hover:flex"
                    onClick={() => onChange({ captureIds: row.captureIds.filter((other) => other !== id) })}
                  >
                    <X className="h-2.5 w-2.5" aria-hidden />
                  </button>
                )}
              </span>
            );
          })}
          {!readOnly && row.captureIds.length < TEST_CAPTURES_PER_ROW && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip"
                multiple
                className="hidden"
                onChange={(event) => void upload(event.target.files)}
              />
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
                className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-dashed border-slate-300 px-2 py-1 text-xs text-sky-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-sky-400"
              >
                <Paperclip className="h-3 w-3" aria-hidden />
                {uploading ? 'Mengunggah…' : 'Lampirkan'}
              </button>
            </>
          )}
          {readOnly && row.captureIds.length === 0 && <span className="text-xs text-slate-400">—</span>}
        </div>
      </td>
      {!readOnly && (
        <td className="px-2 py-2">
          <div className="flex justify-end gap-0.5">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Duplikat skenario ${number}`}
              title="Duplikat ke baris di bawahnya"
              onClick={onDuplicate}
            >
              <Copy className="h-3.5 w-3.5" aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Hapus skenario ${number}`}
              title="Hapus skenario"
              onClick={onRemove}
            >
              <Trash2 className="h-3.5 w-3.5 text-red-500" aria-hidden />
            </Button>
          </div>
        </td>
      )}
    </tr>
  );
}
