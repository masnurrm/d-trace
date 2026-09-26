'use client';

import { ChevronDown, ChevronUp, GripVertical, Plus, Printer, Save, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import {
  TEMPLATE_COMPONENT_LABELS,
  TEMPLATE_DATA_SOURCE_LABELS,
  updateDocumentTemplateSchema,
  type DocumentTemplateView,
  type TemplateSectionInput,
} from '@dtrace/shared';
import { ApiClientError, clientFetch } from '@/lib/api/client';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { TextField, TextareaField } from '@/components/ui/field';
import { cn } from '@/lib/utils/cn';
import { DocumentPreview } from './document-preview';
import { SectionProperties } from './section-properties';
import { makeSection } from './section-defaults';

type Draft = {
  name: string;
  code: string;
  version: string;
  description: string | null;
  isActive: boolean;
  sections: TemplateSectionInput[];
};

function toDraft(template: DocumentTemplateView): Draft {
  return {
    name: template.name,
    code: template.code,
    version: template.version,
    description: template.description,
    isActive: template.isActive,
    // The view rows carry `position`, which the payload derives from the array
    // order instead — sending both would be two sources of truth for one thing.
    sections: template.sections.map(({ position: _position, ...section }) => section),
  };
}

export interface TemplateBuilderProps {
  template: DocumentTemplateView;
  /** A non-admin still sees the builder, read-only; the API refuses the write. */
  canEdit: boolean;
}

/**
 * The three-pane template builder: structure, live document, properties.
 *
 * All of it is one draft in local state, saved in a single request. A builder
 * that saved each keystroke would need a rollback story for every half-applied
 * reorder; keeping the draft local means the document on screen is always
 * internally consistent, and the only moment it has to agree with the server is
 * the one the operator chooses.
 */
export function TemplateBuilder({ template, canEdit }: TemplateBuilderProps) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => toDraft(template));
  const [baseUpdatedAt, setBaseUpdatedAt] = useState(template.updatedAt);
  const [selectedKey, setSelectedKey] = useState<string | null>(
    template.sections[0]?.key ?? null,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<string[]>([]);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const selectedIndex = draft.sections.findIndex((section) => section.key === selectedKey);
  const selected = selectedIndex >= 0 ? draft.sections[selectedIndex]! : null;

  const takenKeys = useMemo(
    () =>
      draft.sections
        .filter((_, index) => index !== selectedIndex)
        .map((section) => section.key.toLowerCase()),
    [draft.sections, selectedIndex],
  );

  const markDirty = useCallback(() => {
    setSavedAt(null);
    setError(null);
    setFieldErrors([]);
  }, []);

  function updateSection(next: TemplateSectionInput) {
    markDirty();
    setDraft((current) => ({
      ...current,
      sections: current.sections.map((section, index) =>
        index === selectedIndex ? next : section,
      ),
    }));
    // The key is the selection handle, so renaming it has to move the cursor
    // with it or the inspector would jump to whatever section is left behind.
    setSelectedKey(next.key);
  }

  function addSection() {
    markDirty();
    const section = makeSection('TEXT', draft.sections.length);
    setDraft((current) => ({ ...current, sections: [...current.sections, section] }));
    setSelectedKey(section.key);
  }

  function deleteSection() {
    if (selectedIndex < 0) return;
    markDirty();
    setDraft((current) => {
      const sections = current.sections.filter((_, index) => index !== selectedIndex);
      setSelectedKey(sections[Math.max(0, selectedIndex - 1)]?.key ?? null);
      return { ...current, sections };
    });
  }

  function moveSection(direction: -1 | 1) {
    if (selectedIndex < 0) return;
    const target = selectedIndex + direction;
    if (target < 0 || target >= draft.sections.length) return;

    markDirty();
    setDraft((current) => {
      const sections = [...current.sections];
      [sections[selectedIndex], sections[target]] = [sections[target]!, sections[selectedIndex]!];
      return { ...current, sections };
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    setFieldErrors([]);

    // Validated here against the same schema the API uses, so a bad grid or a
    // duplicate key is reported next to the field instead of as a 400.
    const parsed = updateDocumentTemplateSchema.safeParse({
      ...draft,
      expectedUpdatedAt: baseUpdatedAt,
    });

    if (!parsed.success) {
      setFieldErrors(
        parsed.error.issues.map((issue) => `${issue.path.join('.') || 'form'}: ${issue.message}`),
      );
      setSaving(false);
      return;
    }

    try {
      const result = await clientFetch<DocumentTemplateView>(`/document-templates/${template.id}`, {
        method: 'PUT',
        body: parsed.data,
      });
      setDraft(toDraft(result.data));
      setBaseUpdatedAt(result.data.updatedAt);
      setSavedAt(new Date().toISOString());
      // The list page reads the same rows on the server; refreshing keeps the
      // name and section count there from going stale behind this tab.
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiClientError ? caught.message : 'Template gagal disimpan.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {!canEdit && (
        <Alert tone="warning" title="Mode baca">
          Hanya role ADMIN yang dapat mengubah master template.
        </Alert>
      )}

      {error && <Alert tone="danger">{error}</Alert>}

      {fieldErrors.length > 0 && (
        <Alert tone="danger" title="Template belum bisa disimpan">
          <ul className="list-disc space-y-0.5 pl-4">
            {fieldErrors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </Alert>
      )}

      {savedAt && <Alert tone="success">Template tersimpan.</Alert>}

      {/*
        Three panes, each scrolling on its own from `xl` up.

        The builder is a comparison: you change a property on the right and
        watch the document in the middle. With one page-level scrollbar, doing
        that scrolled the preview out of view — you had to scroll back to see
        what you had just changed. Giving each pane its own height fixes the
        document in place while the inspector moves.

        Below `xl` the columns stack, and a fixed height there would trap three
        scroll areas inside one screen. The page scrolls normally instead.
      */}
      {/*
        The height budget, erring on the small side deliberately: header 3.5rem
        + marquee ~2.5rem + the main's 4rem of padding + the footer ~3rem. Both
        the marquee and the footer are optional, so when they are off there is a
        little unused space at the bottom — invisible. Guessing too *large* is
        the costly mistake: it brings back the page scrollbar this exists to
        remove. `dvh` rather than `vh` so a mobile browser's collapsing chrome
        does not push the panes past the fold.
      */}
      <div className="grid items-start gap-4 xl:h-[calc(100dvh-13rem)] xl:grid-cols-[300px_minmax(0,1fr)_330px]">
        {/* LEFT — structure */}
        <Card className="xl:flex xl:h-full xl:flex-col xl:overflow-hidden">
          <CardHeader
            className="xl:shrink-0"
            title="Template Structure"
            description="Susun section dokumen."
            action={
              canEdit && (
                <Button
                  size="sm"
                  leftIcon={<Plus className="h-4 w-4" aria-hidden />}
                  onClick={addSection}
                >
                  Section
                </Button>
              )
            }
          />

          <div className="space-y-3 px-5 py-4 xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
            <TextField
              label="Template Name"
              value={draft.name}
              maxLength={120}
              disabled={!canEdit}
              onChange={(event) => {
                markDirty();
                setDraft((current) => ({ ...current, name: event.target.value }));
              }}
            />

            <div className="grid grid-cols-2 gap-2">
              <TextField
                label="Code"
                value={draft.code}
                maxLength={20}
                disabled={!canEdit}
                onChange={(event) => {
                  markDirty();
                  setDraft((current) => ({
                    ...current,
                    code: event.target.value.toUpperCase(),
                  }));
                }}
              />
              <TextField
                label="Version"
                value={draft.version}
                maxLength={20}
                disabled={!canEdit}
                onChange={(event) => {
                  markDirty();
                  setDraft((current) => ({ ...current, version: event.target.value }));
                }}
              />
            </div>

            <TextareaField
              label="Deskripsi"
              value={draft.description ?? ''}
              rows={2}
              maxLength={500}
              disabled={!canEdit}
              onChange={(event) => {
                markDirty();
                setDraft((current) => ({
                  ...current,
                  description: event.target.value || null,
                }));
              }}
            />

            <ul className="space-y-1.5 border-t border-slate-200 pt-3 dark:border-slate-800">
              {draft.sections.map((section, index) => (
                <li key={`${section.key}-${index}`}>
                  <button
                    type="button"
                    onClick={() => setSelectedKey(section.key)}
                    className={cn(
                      'grid w-full grid-cols-[16px_1fr_auto] items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors',
                      section.key === selectedKey
                        ? 'border-sky-500 bg-sky-50 dark:border-sky-600 dark:bg-sky-950'
                        : 'border-slate-200 hover:border-sky-300 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800',
                    )}
                  >
                    <GripVertical className="h-4 w-4 text-slate-400" aria-hidden />
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-semibold text-slate-900 dark:text-slate-100">
                        {index + 1}. {section.title}
                      </span>
                      <span className="block truncate text-[10px] text-slate-500">
                        {TEMPLATE_COMPONENT_LABELS[section.type]} ·{' '}
                        {TEMPLATE_DATA_SOURCE_LABELS[section.source]}
                        {section.required && ' · wajib'}
                      </span>
                    </span>
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[9px] font-bold',
                        section.visible
                          ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'
                          : 'bg-slate-100 text-slate-500 dark:bg-slate-800',
                      )}
                    >
                      {section.visible ? 'ON' : 'OFF'}
                    </span>
                  </button>
                </li>
              ))}
              {draft.sections.length === 0 && (
                <li className="py-4 text-center text-xs text-slate-500">Belum ada section.</li>
              )}
            </ul>

            {canEdit && (
              <>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    leftIcon={<ChevronUp className="h-4 w-4" aria-hidden />}
                    disabled={selectedIndex <= 0}
                    onClick={() => moveSection(-1)}
                  >
                    Naik
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    leftIcon={<ChevronDown className="h-4 w-4" aria-hidden />}
                    disabled={selectedIndex < 0 || selectedIndex >= draft.sections.length - 1}
                    onClick={() => moveSection(1)}
                  >
                    Turun
                  </Button>
                </div>
                <Button
                  block
                  variant="destructive"
                  size="sm"
                  leftIcon={<Trash2 className="h-4 w-4" aria-hidden />}
                  disabled={selectedIndex < 0}
                  onClick={deleteSection}
                >
                  Hapus section terpilih
                </Button>
              </>
            )}
          </div>
        </Card>

        {/* CENTER — the document */}
        <Card className="overflow-hidden xl:flex xl:h-full xl:flex-col">
          <CardHeader
            className="xl:shrink-0"
            title="Live Document Preview"
            description="Preview mengikuti konfigurasi master template."
            action={
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  leftIcon={<Printer className="h-4 w-4" aria-hidden />}
                  onClick={() => window.print()}
                >
                  Print
                </Button>
                {canEdit && (
                  <Button
                    size="sm"
                    loading={saving}
                    leftIcon={<Save className="h-4 w-4" aria-hidden />}
                    onClick={save}
                  >
                    Simpan
                  </Button>
                )}
              </div>
            }
          />
          {/* The header stays put; only the page itself scrolls. */}
          <div className="xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
            <DocumentPreview
              sections={draft.sections}
              selectedKey={selectedKey}
              onSelect={setSelectedKey}
            />
          </div>
        </Card>

        {/* RIGHT — properties */}
        <Card className="xl:flex xl:h-full xl:flex-col xl:overflow-hidden">
          <CardHeader
            className="xl:shrink-0"
            title="Section Properties"
            description={selected ? selected.title : 'Pilih section'}
          />
          <div className="xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
            {canEdit ? (
              <SectionProperties
                section={selected}
                onChange={updateSection}
                takenKeys={takenKeys}
                templateId={template.id}
              />
            ) : (
              <p className="px-5 py-6 text-sm text-slate-500">
                Properti section hanya dapat diubah oleh ADMIN.
              </p>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
