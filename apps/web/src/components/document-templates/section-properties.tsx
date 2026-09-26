'use client';

import { ArrowDown, ArrowUp, ImagePlus, Pencil, Plus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import {
  INFO_FIELD_KINDS,
  INFO_FIELD_KIND_LABELS,
  TEMPLATE_COMPONENT_LABELS,
  TEMPLATE_COMPONENT_TYPES,
  TEMPLATE_DATA_SOURCES,
  TEMPLATE_DATA_SOURCE_LABELS,
  TEMPLATE_IMAGE_MAX_BYTES,
  TEMPLATE_IMAGE_MIME_TYPES,
  TEMPLATE_IMAGE_WIDTHS,
  TEMPLATE_IMAGE_WIDTH_LABELS,
  templateAssetUrl,
  infoRowSchema,
  DOCUMENT_PLACEHOLDER_EXAMPLES,
  PROJECT_DATASETS,
  PROJECT_DATASET_LABELS,
  type DataConfig,
  type ApprovalColumn,
  type ApprovalConfig,
  type ChecklistConfig,
  type ChecklistGroup,
  type HeaderConfig,
  type InfoConfig,
  type InfoRow,
  type TemplateAssetView,
  type TemplateAttachment,
  type TemplateComponentType,
  type TemplateSectionInput,
  type TextConfig,
} from '@dtrace/shared';
import { ApiClientError, clientFetch } from '@/lib/api/client';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { SelectField, TextField, TextareaField } from '@/components/ui/field';
import { FlowEditor } from './flow-editor';
import { TableEditor } from './table-editor';
import { changeSectionType, localId, normaliseKey } from './section-defaults';

export interface SectionPropertiesProps {
  section: TemplateSectionInput | null;
  onChange: (section: TemplateSectionInput) => void;
  /** Keys already used by other sections, so a clash is flagged as it is typed. */
  takenKeys: string[];
  /** The saved template the images are uploaded against. */
  templateId: string;
}

/**
 * The right-hand inspector.
 *
 * Everything common to a section is edited inline; the two components with a
 * shape of their own — the process flow and the table — open a dedicated modal,
 * because a grid is not something a 300px column can hold honestly.
 */
export function SectionProperties({
  section,
  onChange,
  takenKeys,
  templateId,
}: SectionPropertiesProps) {
  const [flowOpen, setFlowOpen] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);

  if (!section) {
    return (
      <p className="px-5 py-6 text-sm text-slate-500">
        Pilih satu section di panel kiri untuk mengubah propertinya.
      </p>
    );
  }

  const keyClash = takenKeys.includes(section.key.toLowerCase());

  return (
    <div className="space-y-4 px-5 py-4">
      <Alert tone="info">
        <b>Data Source</b> menentukan apakah isi section otomatis dari project, diisi manual, atau
        gabungan keduanya.
      </Alert>

      <TextField
        label="Judul Section"
        value={section.title}
        maxLength={120}
        onChange={(event) => onChange({ ...section, title: event.target.value })}
      />

      <TextField
        label="Section Key"
        value={section.key}
        maxLength={60}
        error={keyClash ? 'Key ini sudah dipakai section lain' : undefined}
        hint="Dipakai dokumen untuk merujuk section ini. Hindari mengubahnya setelah dipakai."
        onChange={(event) => onChange({ ...section, key: normaliseKey(event.target.value) })}
      />

      <SelectField
        label="Component Type"
        value={section.type}
        options={TEMPLATE_COMPONENT_TYPES.map((type) => ({
          value: type,
          label: TEMPLATE_COMPONENT_LABELS[type],
        }))}
        hint="Mengganti tipe akan mengatur ulang konfigurasi khusus komponen ini."
        onValueChange={(value) =>
          onChange(changeSectionType(section, value as TemplateComponentType))
        }
      />

      <SelectField
        label="Data Source"
        value={section.source}
        options={TEMPLATE_DATA_SOURCES.map((source) => ({
          value: source,
          label: TEMPLATE_DATA_SOURCE_LABELS[source],
        }))}
        onValueChange={(value) =>
          onChange({ ...section, source: value as TemplateSectionInput['source'] })
        }
      />

      <TextField
        label="Binding Key"
        value={section.binding ?? ''}
        placeholder="contoh: project.scopeOfWork"
        hint="Kosongkan jika isi section tidak diambil dari data project."
        onChange={(event) => onChange({ ...section, binding: event.target.value.trim() || null })}
      />

      <PlaceholderHelp />

      {section.type === 'TEXT' && (
        <>
          <TextareaField
            label="Default / Placeholder Content"
            value={section.content ?? ''}
            rows={4}
            placeholder="Isi default section..."
            hint="Bisa memakai placeholder seperti {{project.name}}."
            onChange={(event) => onChange({ ...section, content: event.target.value || null })}
          />
          <TextConfigEditor
            config={section.config}
            onChange={(config) => onChange({ ...section, config })}
          />
        </>
      )}

      {section.type === 'HEADER' && (
        <HeaderConfigEditor
          templateId={templateId}
          config={section.config}
          onChange={(config) => onChange({ ...section, config })}
        />
      )}

      {section.type === 'DATA' && (
        <DataConfigEditor
          config={section.config}
          onChange={(config) => onChange({ ...section, config })}
        />
      )}

      {section.type === 'INFO' && (
        <InfoConfigEditor
          config={section.config}
          onChange={(config) => onChange({ ...section, config })}
        />
      )}

      {section.type === 'CHECKLIST' && (
        <ChecklistConfigEditor
          config={section.config}
          onChange={(config) => onChange({ ...section, config })}
        />
      )}

      {section.type === 'APPROVAL' && (
        <ApprovalConfigEditor
          config={section.config}
          onChange={(config) => onChange({ ...section, config })}
        />
      )}

      {section.type === 'FLOW' && (
        <>
          <div className="rounded-lg border border-slate-200 px-3 py-3 dark:border-slate-800">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Process Flow</p>
            <p className="mt-0.5 text-xs text-slate-500">
              {section.config.nodes.length} node · {section.config.edges.length} panah
            </p>
            <Button
              block
              variant="outline"
              className="mt-3"
              leftIcon={<Pencil className="h-4 w-4" aria-hidden />}
              onClick={() => setFlowOpen(true)}
            >
              Buka editor flow
            </Button>
          </div>
          <FlowEditor
            open={flowOpen}
            onClose={() => setFlowOpen(false)}
            config={section.config}
            onChange={(config) => onChange({ ...section, config })}
          />
        </>
      )}

      {section.type === 'TABLE' && (
        <>
          <div className="rounded-lg border border-slate-200 px-3 py-3 dark:border-slate-800">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Tabel</p>
            <p className="mt-0.5 text-xs text-slate-500">
              {section.config.rows.length} baris × {section.config.columns.length} kolom
            </p>
            <Button
              block
              variant="outline"
              className="mt-3"
              leftIcon={<Pencil className="h-4 w-4" aria-hidden />}
              onClick={() => setTableOpen(true)}
            >
              Buka editor tabel
            </Button>
          </div>
          <TableEditor
            open={tableOpen}
            onClose={() => setTableOpen(false)}
            config={section.config}
            onChange={(config) => onChange({ ...section, config })}
          />
        </>
      )}

      <AttachmentsEditor
        templateId={templateId}
        attachments={section.attachments}
        onChange={(attachments) => onChange({ ...section, attachments })}
      />

      <div className="space-y-2 border-t border-slate-200 pt-4 dark:border-slate-800">
        <Checkbox
          label="Editable by User"
          checked={section.editable}
          onChange={(event) => onChange({ ...section, editable: event.target.checked })}
        />
        <Checkbox
          label="Required"
          checked={section.required}
          onChange={(event) => onChange({ ...section, required: event.target.checked })}
        />
        <Checkbox
          label="Visible"
          checked={section.visible}
          onChange={(event) => onChange({ ...section, visible: event.target.checked })}
        />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Inline config editors                                                       */
/* -------------------------------------------------------------------------- */

function TextConfigEditor({
  config,
  onChange,
}: {
  config: TextConfig;
  onChange: (config: TextConfig) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <TextField
        label="Placeholder"
        value={config.placeholder}
        maxLength={200}
        onChange={(event) => onChange({ ...config, placeholder: event.target.value })}
      />
      <TextField
        label="Tinggi (baris)"
        type="number"
        min={1}
        max={30}
        value={config.minRows}
        onChange={(event) =>
          onChange({ ...config, minRows: clamp(Number(event.target.value), 1, 30) })
        }
      />
    </div>
  );
}

function HeaderConfigEditor({
  templateId,
  config,
  onChange,
}: {
  templateId: string;
  config: HeaderConfig;
  onChange: (config: HeaderConfig) => void;
}) {
  const logoInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function uploadLogo(file: File | undefined) {
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const asset = await uploadTemplateImage(templateId, file);
      onChange({ ...config, logoAssetId: asset.id });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Logo gagal diunggah.');
    } finally {
      setUploading(false);
      if (logoInput.current) logoInput.current.value = '';
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
      <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Header dokumen</p>

      <div className="space-y-2">
        <p className="text-xs font-medium text-slate-500">Logo</p>
        <div className="flex items-center gap-2">
          <div className="flex h-14 w-24 shrink-0 items-center justify-center rounded border border-slate-200 bg-white text-xs text-slate-400 dark:border-slate-800">
            {config.logoAssetId ? (
              // eslint-disable-next-line @next/next/no-img-element -- per-user BFF asset
              <img
                src={templateAssetUrl(config.logoAssetId)}
                alt=""
                className="max-h-12 max-w-[88px] object-contain"
              />
            ) : (
              'teks'
            )}
          </div>
          <div className="flex flex-col gap-1">
            <Button
              size="sm"
              variant="outline"
              loading={uploading}
              leftIcon={<ImagePlus className="h-4 w-4" aria-hidden />}
              onClick={() => logoInput.current?.click()}
            >
              {config.logoAssetId ? 'Ganti logo' : 'Unggah logo'}
            </Button>
            {config.logoAssetId && (
              <Button size="sm" variant="ghost" onClick={() => onChange({ ...config, logoAssetId: null })}>
                Pakai teks logo
              </Button>
            )}
          </div>
          <input
            ref={logoInput}
            type="file"
            accept={TEMPLATE_IMAGE_MIME_TYPES.join(',')}
            className="hidden"
            onChange={(event) => void uploadLogo(event.target.files?.[0])}
          />
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
      </div>

      <TextField
        label="Judul dokumen (bar kuning)"
        value={config.documentTitle}
        maxLength={120}
        onChange={(event) => onChange({ ...config, documentTitle: event.target.value })}
      />

      <div className="grid grid-cols-2 gap-2">
        <TextField
          label="Label rahasia"
          value={config.confidentialLabel}
          maxLength={60}
          onChange={(event) => onChange({ ...config, confidentialLabel: event.target.value })}
        />
        <TextField
          label="Teks logo"
          value={config.logoText}
          maxLength={40}
          onChange={(event) => onChange({ ...config, logoText: event.target.value })}
        />
      </div>

      <TextareaField
        label="Kolom tengah (satu baris per baris teks)"
        value={config.centerLines.join('\n')}
        rows={2}
        onChange={(event) => onChange({ ...config, centerLines: toLines(event.target.value) })}
      />

      <TextareaField
        label="Kolom kanan (satu baris per baris teks)"
        value={config.rightLines.join('\n')}
        rows={2}
        onChange={(event) => onChange({ ...config, rightLines: toLines(event.target.value) })}
      />

      <p className="text-xs text-slate-500">
        Tulis <code>{'{{input:Nomor BPM}}'}</code> di sebuah baris untuk isian yang diisi per
        dokumen, mis. <code>{'{{hierarchy.PROJECT_DEPARTMENT.code}} – ({{input:Nomor BPM}})'}</code>.
      </p>

      <div className="grid grid-cols-2 gap-2">
        <TextField
          label="Baris tebal (tengah)"
          type="number"
          min={0}
          max={4}
          value={config.centerBoldLines}
          onChange={(event) =>
            onChange({ ...config, centerBoldLines: clamp(Number(event.target.value), 0, 4) })
          }
        />
        <TextField
          label="Baris tebal (kanan)"
          type="number"
          min={0}
          max={4}
          value={config.rightBoldLines}
          onChange={(event) =>
            onChange({ ...config, rightBoldLines: clamp(Number(event.target.value), 0, 4) })
          }
        />
      </div>

      <div className="grid grid-cols-[100px_1fr] gap-2">
        <TextField
          label="Label judul"
          value={config.titleLabel}
          maxLength={40}
          onChange={(event) => onChange({ ...config, titleLabel: event.target.value })}
        />
        <TextField
          label="Isi judul"
          value={config.titleValue}
          maxLength={200}
          onChange={(event) => onChange({ ...config, titleValue: event.target.value })}
        />
      </div>
    </div>
  );
}

function InfoConfigEditor({
  config,
  onChange,
}: {
  config: InfoConfig;
  onChange: (config: InfoConfig) => void;
}) {
  function updateRow(id: string, patch: Partial<InfoRow>) {
    onChange({
      ...config,
      rows: config.rows.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    });
  }

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
          Baris informasi ({config.rows.length})
        </p>
        <Button
          variant="outline"
          size="sm"
          leftIcon={<Plus className="h-4 w-4" aria-hidden />}
          disabled={config.rows.length >= 40}
          onClick={() =>
            onChange({
              ...config,
              rows: [
                ...config.rows,
                infoRowSchema.parse({ id: localId(), label: 'Label', mode: 'INPUT' }),
              ],
            })
          }
        >
          Baris
        </Button>
      </div>

      {config.rows.map((row) => (
        <div key={row.id} className="space-y-2 rounded-md bg-slate-50 p-2 dark:bg-slate-950">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <TextField
                label="Label"
                value={row.label}
                maxLength={80}
                onChange={(event) => updateRow(row.id, { label: event.target.value })}
              />
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Hapus baris ${row.label}`}
              onClick={() =>
                onChange({ ...config, rows: config.rows.filter((item) => item.id !== row.id) })
              }
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </Button>
          </div>

          <TextField
            label="Isi"
            value={row.value}
            maxLength={2000}
            placeholder={row.mode === 'INPUT' ? 'dikosongkan untuk user' : 'isi tetap'}
            onChange={(event) => updateRow(row.id, { value: event.target.value })}
          />

          <div className="grid grid-cols-2 gap-2">
            <SelectField
              label="Jenis isi"
              value={row.mode}
              options={[
                { value: 'FIXED', label: 'Tetap' },
                { value: 'INPUT', label: 'Diisi user' },
              ]}
              onValueChange={(value) => updateRow(row.id, { mode: value as InfoRow['mode'] })}
            />
            <SelectField
              label="Lebar"
              value={row.span}
              options={[
                { value: 'full', label: 'Satu baris penuh' },
                { value: 'half', label: 'Setengah baris' },
              ]}
              onValueChange={(value) => updateRow(row.id, { span: value as InfoRow['span'] })}
            />
          </div>

          {/* Only a blank has a kind — a fixed cell is text this template wrote. */}
          {row.mode === 'INPUT' && (
            <>
              <SelectField
                label="Bentuk isian"
                value={row.field}
                options={INFO_FIELD_KINDS.map((kind) => ({
                  value: kind,
                  label: INFO_FIELD_KIND_LABELS[kind],
                }))}
                onValueChange={(value) => updateRow(row.id, { field: value as InfoRow['field'] })}
              />

              {row.field === 'SELECT' && (
                <TextareaField
                  label="Pilihan"
                  hint="Satu pilihan per baris."
                  value={row.options.join('\n')}
                  rows={3}
                  onChange={(event) =>
                    updateRow(row.id, {
                      options: event.target.value
                        .split('\n')
                        .map((option) => option.trim())
                        .filter(Boolean)
                        .slice(0, 40),
                    })
                  }
                />
              )}

              {row.field === 'DURATION' && (
                <div className="grid grid-cols-2 gap-2">
                  <TextField
                    label="Satuan pertama"
                    value={row.units[0] ?? ''}
                    maxLength={16}
                    placeholder="Jam"
                    onChange={(event) =>
                      updateRow(row.id, { units: [event.target.value, row.units[1] ?? ''] })
                    }
                  />
                  <TextField
                    label="Satuan kedua"
                    value={row.units[1] ?? ''}
                    maxLength={16}
                    placeholder="Menit"
                    onChange={(event) =>
                      updateRow(row.id, { units: [row.units[0] ?? '', event.target.value] })
                    }
                  />
                </div>
              )}
            </>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * The checklist inspector: the groups and the items inside them.
 *
 * Items are edited as one textarea per group, a line each, rather than as a
 * list of fields with add and remove buttons. A release checklist is written by
 * pasting the standard in — twenty-nine lines at once — and a form that makes
 * somebody click "Item" twenty-nine times is a form they will fill in
 * somewhere else and paste anyway.
 *
 * An item's id is kept across an edit when its text is unchanged, matched by
 * position. That is what stops a typo in line two from orphaning the answers
 * already recorded against lines three onward.
 */
function ChecklistConfigEditor({
  config,
  onChange,
}: {
  config: ChecklistConfig;
  onChange: (config: ChecklistConfig) => void;
}) {
  function updateGroup(id: string, patch: Partial<ChecklistGroup>) {
    onChange({
      ...config,
      groups: config.groups.map((group) => (group.id === id ? { ...group, ...patch } : group)),
    });
  }

  function setItems(group: ChecklistGroup, text: string) {
    const lines = text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 80);

    updateGroup(group.id, {
      items: lines.map((line, index) => {
        // `Nama item | keterangan` — the first bar splits, so a description may
        // itself contain one.
        const bar = line.indexOf('|');
        const label = (bar === -1 ? line : line.slice(0, bar)).trim() || line;
        const description =
          bar === -1
            ? ''
            : line
                .slice(bar + 1)
                .trim()
                .slice(0, 500);
        const previous = group.items[index];
        // Same position and same name: it is the same item, so it keeps its id
        // and the answers already filed against it — rewording the description
        // does not make it a different item.
        return {
          id: previous && previous.label === label ? previous.id : localId(),
          label,
          description,
        };
      }),
    });
  }

  const total = config.groups.reduce((sum, group) => sum + group.items.length, 0);

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
          Kelompok ({config.groups.length}) · {total} item
        </p>
        <Button
          variant="outline"
          size="sm"
          leftIcon={<Plus className="h-4 w-4" aria-hidden />}
          disabled={config.groups.length >= 20}
          onClick={() =>
            onChange({
              ...config,
              groups: [...config.groups, { id: localId(), title: 'Kelompok baru', items: [] }],
            })
          }
        >
          Kelompok
        </Button>
      </div>

      <TextField
        label="Diisi oleh"
        value={config.filledByLabel}
        maxLength={120}
        placeholder="mis. Diisi oleh IT Operation sebagai Checker"
        onChange={(event) => onChange({ ...config, filledByLabel: event.target.value })}
      />

      <fieldset className="space-y-1.5">
        <legend className="text-xs font-medium text-slate-500">Kolom yang ditampilkan</legend>
        {(
          [
            ['showRemark', 'Remark'],
            ['showChecker', 'Checker'],
            ['showDate', 'Date'],
            ['showEvidence', 'Evidence'],
          ] as const
        ).map(([key, label]) => (
          <Checkbox
            key={key}
            label={label}
            checked={config[key]}
            onChange={(event) => onChange({ ...config, [key]: event.target.checked })}
          />
        ))}
      </fieldset>

      {config.groups.map((group) => (
        <div key={group.id} className="space-y-2 rounded-md bg-slate-50 p-2 dark:bg-slate-950">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <TextField
                label="Nama kelompok"
                value={group.title}
                maxLength={120}
                onChange={(event) => updateGroup(group.id, { title: event.target.value })}
              />
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Hapus kelompok ${group.title}`}
              onClick={() =>
                onChange({
                  ...config,
                  groups: config.groups.filter((item) => item.id !== group.id),
                })
              }
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </Button>
          </div>

          <TextareaField
            label={`Item (${group.items.length})`}
            hint="Satu item per baris. Tambahkan keterangan setelah tanda | (Nama item | keterangan)."
            value={group.items
              .map((item) =>
                item.description ? `${item.label} | ${item.description}` : item.label,
              )
              .join('\n')}
            rows={Math.min(Math.max(group.items.length + 1, 3), 14)}
            onChange={(event) => setItems(group, event.target.value)}
          />
        </div>
      ))}
    </div>
  );
}

function ApprovalConfigEditor({
  config,
  onChange,
}: {
  config: ApprovalConfig;
  onChange: (config: ApprovalConfig) => void;
}) {
  function updateColumn(id: string, patch: Partial<ApprovalColumn>) {
    onChange({
      ...config,
      columns: config.columns.map((column) =>
        column.id === id ? { ...column, ...patch } : column,
      ),
    });
  }

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
          Kolom tanda tangan ({config.columns.length})
        </p>
        <Button
          variant="outline"
          size="sm"
          leftIcon={<Plus className="h-4 w-4" aria-hidden />}
          disabled={config.columns.length >= 6}
          onClick={() =>
            onChange({
              ...config,
              columns: [
                ...config.columns,
                {
                  id: localId(),
                  label: 'Jabatan',
                  prefix: 'Approved by',
                  name: '',
                  mode: 'INPUT',
                  showDate: false,
                },
              ],
            })
          }
        >
          Kolom
        </Button>
      </div>

      {config.columns.map((column, index) => (
        <div key={column.id} className="space-y-2 rounded-md bg-slate-50 p-2 dark:bg-slate-950">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <TextField
                label={`Label kolom ${index + 1}`}
                value={column.label}
                maxLength={80}
                placeholder="Technical Lead"
                onChange={(event) => updateColumn(column.id, { label: event.target.value })}
              />
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Hapus kolom ${index + 1}`}
              disabled={config.columns.length <= 1}
              onClick={() =>
                onChange({
                  ...config,
                  columns: config.columns.filter((item) => item.id !== column.id),
                })
              }
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <TextField
              label="Awalan"
              value={column.prefix}
              maxLength={40}
              placeholder="Approved by"
              onChange={(event) => updateColumn(column.id, { prefix: event.target.value })}
            />
            <SelectField
              label="Nama penanda tangan"
              value={column.mode}
              options={[
                { value: 'INPUT', label: 'Diisi user' },
                { value: 'FIXED', label: 'Tetap' },
              ]}
              onValueChange={(value) =>
                updateColumn(column.id, { mode: value as ApprovalColumn['mode'] })
              }
            />
          </div>

          {column.mode === 'FIXED' && (
            <TextField
              label="Nama"
              value={column.name}
              maxLength={80}
              onChange={(event) => updateColumn(column.id, { name: event.target.value })}
            />
          )}

          <Checkbox
            label="Tampilkan baris tanggal"
            checked={column.showDate}
            onChange={(event) => updateColumn(column.id, { showDate: event.target.checked })}
          />
        </div>
      ))}

      <TextField
        label="Tinggi kotak (px)"
        type="number"
        min={40}
        max={220}
        value={config.boxHeight}
        onChange={(event) =>
          onChange({ ...config, boxHeight: clamp(Number(event.target.value), 40, 220) })
        }
      />
    </div>
  );
}

const MAX_ATTACHMENTS = 10;

/**
 * Images printed under the section.
 *
 * An image is uploaded the moment it is picked, and only its id joins the
 * section — the template is saved as one JSON payload and bytes do not belong
 * in it. Until the template is saved, the upload is an asset nothing points at;
 * that is cheaper than making the save a multipart request.
 */
function AttachmentsEditor({
  templateId,
  attachments,
  onChange,
}: {
  templateId: string;
  attachments: TemplateAttachment[];
  onChange: (attachments: TemplateAttachment[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);

    const room = MAX_ATTACHMENTS - attachments.length;
    const picked = Array.from(files).slice(0, room);
    const tooBig = picked.find((file) => file.size > TEMPLATE_IMAGE_MAX_BYTES);
    if (tooBig) {
      setError(
        `"${tooBig.name}" melebihi ${TEMPLATE_IMAGE_MAX_BYTES / 1024 / 1024} MB.`,
      );
      return;
    }

    setUploading(true);
    const added: TemplateAttachment[] = [];
    try {
      for (const file of picked) {
        const asset = await uploadTemplateImage(templateId, file);
        added.push({ assetId: asset.id, fileName: asset.fileName, caption: '', width: 'medium' });
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Gambar gagal diunggah.');
    } finally {
      // Whatever made it up before a failure is kept rather than thrown away.
      if (added.length > 0) onChange([...attachments, ...added]);
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function update(index: number, patch: Partial<TemplateAttachment>) {
    onChange(attachments.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function move(index: number, by: -1 | 1) {
    const next = [...attachments];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item!);
    onChange(next);
  }

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
          Lampiran gambar ({attachments.length})
        </p>
        <Button
          variant="outline"
          size="sm"
          leftIcon={<ImagePlus className="h-4 w-4" aria-hidden />}
          loading={uploading}
          disabled={attachments.length >= MAX_ATTACHMENTS}
          onClick={() => inputRef.current?.click()}
        >
          Gambar
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept={TEMPLATE_IMAGE_MIME_TYPES.join(',')}
          multiple
          className="hidden"
          onChange={(event) => void upload(event.target.files)}
        />
      </div>

      <p className="text-xs text-slate-500">
        PNG, JPG, GIF, atau WEBP, maks. {TEMPLATE_IMAGE_MAX_BYTES / 1024 / 1024} MB per gambar.
        Gambar tampil di bawah section ini pada setiap dokumen. Simpan template agar perubahan
        tersimpan.
      </p>

      {error && <Alert tone="danger">{error}</Alert>}

      {attachments.map((attachment, index) => (
        <div
          key={attachment.assetId}
          className="space-y-2 rounded-md bg-slate-50 p-2 dark:bg-slate-950"
        >
          <div className="flex items-start gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- per-user BFF asset */}
            <img
              src={templateAssetUrl(attachment.assetId)}
              alt=""
              className="h-14 w-20 shrink-0 rounded border border-slate-200 bg-white object-contain dark:border-slate-800"
            />
            <p className="min-w-0 flex-1 truncate pt-1 text-xs text-slate-600 dark:text-slate-300">
              {attachment.fileName || 'Gambar'}
            </p>
            <div className="flex shrink-0">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Naikkan gambar"
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                <ArrowUp className="h-4 w-4" aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Turunkan gambar"
                disabled={index === attachments.length - 1}
                onClick={() => move(index, 1)}
              >
                <ArrowDown className="h-4 w-4" aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Hapus gambar ${attachment.fileName}`}
                onClick={() => onChange(attachments.filter((_, i) => i !== index))}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </Button>
            </div>
          </div>

          <TextField
            label="Keterangan"
            value={attachment.caption}
            maxLength={200}
            placeholder="mis. Gambar 1 – Alur persetujuan"
            onChange={(event) => update(index, { caption: event.target.value })}
          />

          <SelectField
            label="Lebar"
            value={attachment.width}
            options={TEMPLATE_IMAGE_WIDTHS.map((width) => ({
              value: width,
              label: TEMPLATE_IMAGE_WIDTH_LABELS[width],
            }))}
            onValueChange={(value) =>
              update(index, { width: value as TemplateAttachment['width'] })
            }
          />
        </div>
      ))}
    </div>
  );
}

/**
 * The data a DATA section lays out. Nothing to type: the numbers are the
 * project's, taken from Mandays and the Timeline when a document is saved.
 */
function DataConfigEditor({
  config,
  onChange,
}: {
  config: DataConfig;
  onChange: (config: DataConfig) => void;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
      <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Data project</p>

      <SelectField
        label="Data yang ditampilkan"
        value={config.dataset}
        options={PROJECT_DATASETS.map((dataset) => ({
          value: dataset,
          label: PROJECT_DATASET_LABELS[dataset],
        }))}
        onValueChange={(value) => onChange({ ...config, dataset: value as DataConfig['dataset'] })}
      />

      <TextareaField
        label="Kalimat pembuka"
        value={config.intro}
        rows={2}
        maxLength={500}
        placeholder="mis. Aktivitas yang akan dilakukan selama project dijelaskan pada tabel di bawah ini."
        onChange={(event) => onChange({ ...config, intro: event.target.value })}
      />

      {config.dataset === 'MANDAY_EFFORT' && (
        <div className="space-y-1.5">
          <Checkbox
            label="Rincian per minggu (dari Timeline)"
            checked={config.showWeeks}
            onChange={(event) => onChange({ ...config, showWeeks: event.target.checked })}
          />
          <Checkbox
            label="Resource yang dibutuhkan (dari tim project)"
            checked={config.showResources}
            onChange={(event) => onChange({ ...config, showResources: event.target.checked })}
          />
        </div>
      )}

      <p className="text-xs text-slate-500">
        Angka diambil dari menu Mandays &amp; Timeline project, lalu dibekukan saat dokumen disimpan.
        Penulis dokumen bisa menekan &quot;Perbarui dari Mandays&quot; untuk mengambil ulang.
      </p>
    </div>
  );
}

/** Which `{{…}}` bindings exist — collapsed, because it is reference, not a form. */
function PlaceholderHelp() {
  return (
    <details className="rounded-md border border-slate-200 px-3 py-2 text-xs text-slate-600 dark:border-slate-800 dark:text-slate-300">
      <summary className="cursor-pointer font-medium">Placeholder data project</summary>
      <p className="mt-2">
        Bisa dipakai di teks tetap, header, dan isian info (sebagai isi awal yang bisa diubah).
      </p>
      <ul className="mt-1 space-y-0.5">
        {DOCUMENT_PLACEHOLDER_EXAMPLES.map((item) => (
          <li key={item.key}>
            <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">{`{{${item.key}}}`}</code>{' '}
            — {item.label}
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Uploads one image to the template's asset store. */
async function uploadTemplateImage(templateId: string, file: File): Promise<TemplateAssetView> {
  if (file.size > TEMPLATE_IMAGE_MAX_BYTES) {
    throw new Error(`"${file.name}" melebihi ${TEMPLATE_IMAGE_MAX_BYTES / 1024 / 1024} MB.`);
  }
  const form = new FormData();
  form.append('file', file);
  try {
    const result = await clientFetch<TemplateAssetView>(`/document-templates/${templateId}/assets`, {
      method: 'POST',
      body: form,
    });
    return result.data;
  } catch (caught) {
    if (caught instanceof ApiClientError) {
      throw new Error(caught.details?.[0]?.message ?? caught.message);
    }
    throw caught;
  }
}

function toLines(value: string): string[] {
  // Capped at four, which is what the header cell can hold before it overflows
  // the printed box.
  return value.split('\n').slice(0, 4);
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}
