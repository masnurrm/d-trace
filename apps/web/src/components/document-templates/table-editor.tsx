'use client';

import { Plus, Trash2 } from 'lucide-react';
import { SelectControl } from '@/components/ui/field';
import type { TableCell, TableColumn, TableConfig } from '@dtrace/shared';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Modal } from '@/components/ui/modal';
import { cn } from '@/lib/utils/cn';
import { localId } from './section-defaults';

const blankCell = (): TableCell => ({ value: '', mode: 'INPUT' });

export interface TableEditorProps {
  open: boolean;
  onClose: () => void;
  config: TableConfig;
  onChange: (config: TableConfig) => void;
}

/**
 * The activity-table editor.
 *
 * Two decisions live here, and they are different in kind. The grid size and
 * the column headings shape the table for every document. Each individual cell
 * then chooses between *tetap* — written once here, identical in every
 * document produced — and *isian*, a blank left for whoever fills the document
 * in. Toggling that per cell is the reason this is a grid editor rather than a
 * pair of number inputs.
 */
export function TableEditor({ open, onClose, config, onChange }: TableEditorProps) {
  const rowCount = config.rows.length;

  function setColumns(columns: TableColumn[]) {
    // Every row is resized in the same update: a row that keeps the old width
    // would fail validation at the boundary and lose the operator's work.
    const rows = config.rows.map((row) =>
      columns.map((_, index) => row[index] ?? blankCell()),
    );
    onChange({ ...config, columns, rows });
  }

  function addColumn() {
    if (config.columns.length >= 12) return;
    setColumns([
      ...config.columns,
      { id: localId(), label: `Kolom ${config.columns.length + 1}`, width: null, align: 'left' },
    ]);
  }

  function removeColumn(index: number) {
    if (config.columns.length <= 1) return;
    onChange({
      ...config,
      columns: config.columns.filter((_, position) => position !== index),
      rows: config.rows.map((row) => row.filter((_, position) => position !== index)),
    });
  }

  function addRow() {
    if (rowCount >= 60) return;
    onChange({ ...config, rows: [...config.rows, config.columns.map(blankCell)] });
  }

  function removeRow(index: number) {
    onChange({ ...config, rows: config.rows.filter((_, position) => position !== index) });
  }

  function updateCell(rowIndex: number, columnIndex: number, patch: Partial<TableCell>) {
    onChange({
      ...config,
      rows: config.rows.map((row, position) =>
        position === rowIndex
          ? row.map((cell, cellPosition) =>
              cellPosition === columnIndex ? { ...cell, ...patch } : cell,
            )
          : row,
      ),
    });
  }

  function updateColumn(index: number, patch: Partial<TableColumn>) {
    setColumns(
      config.columns.map((column, position) =>
        position === index ? { ...column, ...patch } : column,
      ),
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title="Editor Tabel"
      description="Atur jumlah kolom dan baris, lalu tentukan sel mana yang sudah terisi dari template dan mana yang dikosongkan untuk user."
      footer={<Button onClick={onClose}>Selesai</Button>}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={addColumn}>
            Kolom
          </Button>
          <Button variant="outline" size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={addRow}>
            Baris
          </Button>
          <span className="text-xs text-slate-500">
            {rowCount} baris × {config.columns.length} kolom
          </span>
        </div>

        <div className="flex flex-wrap gap-4">
          <Checkbox
            label="Tampilkan baris header"
            checked={config.showHeader}
            onChange={(event) => onChange({ ...config, showHeader: event.target.checked })}
          />
          <Checkbox
            label="Nomor otomatis"
            checked={config.numbered}
            onChange={(event) => onChange({ ...config, numbered: event.target.checked })}
          />
          <Checkbox
            label="User boleh menambah baris"
            checked={config.allowUserRows}
            onChange={(event) => onChange({ ...config, allowUserRows: event.target.checked })}
          />
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-900">
                <th className="w-8 border-b border-slate-200 p-1 dark:border-slate-800" />
                {config.columns.map((column, index) => (
                  <th
                    key={column.id}
                    className="min-w-[150px] border-b border-l border-slate-200 p-2 align-top dark:border-slate-800"
                  >
                    <div className="flex items-center gap-1">
                      <input
                        value={column.label}
                        maxLength={80}
                        aria-label={`Judul kolom ${index + 1}`}
                        onChange={(event) => updateColumn(index, { label: event.target.value })}
                        className="w-full rounded border border-slate-300 px-2 py-1 text-xs font-semibold dark:border-slate-700 dark:bg-slate-900"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Hapus kolom ${index + 1}`}
                        disabled={config.columns.length <= 1}
                        onClick={() => removeColumn(index)}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                    </div>
                    <div className="mt-1 flex items-center gap-1">
                      <SelectControl
                        value={column.align}
                        aria-label={`Perataan kolom ${index + 1}`}
                        onValueChange={(align) =>
                          align && updateColumn(index, { align: align as TableColumn['align'] })
                        }
                        options={[
                          { value: 'left', label: 'Kiri' },
                          { value: 'center', label: 'Tengah' },
                          { value: 'right', label: 'Kanan' },
                        ]}
                        className="h-7 w-28 text-[11px] font-normal"
                      />
                      <input
                        type="number"
                        min={3}
                        max={100}
                        value={column.width ?? ''}
                        placeholder="lebar %"
                        aria-label={`Lebar kolom ${index + 1} dalam persen`}
                        onChange={(event) =>
                          updateColumn(index, {
                            width: event.target.value === '' ? null : Number(event.target.value),
                          })
                        }
                        className="w-20 rounded border border-slate-300 px-1 py-0.5 text-[11px] font-normal dark:border-slate-700 dark:bg-slate-900"
                      />
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {config.rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="align-top">
                  <td className="border-t border-slate-200 p-1 text-center dark:border-slate-800">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Hapus baris ${rowIndex + 1}`}
                      onClick={() => removeRow(rowIndex)}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  </td>
                  {row.map((cell, columnIndex) => (
                    <td
                      key={config.columns[columnIndex]?.id ?? columnIndex}
                      className="border-l border-t border-slate-200 p-2 dark:border-slate-800"
                    >
                      <input
                        value={cell.value}
                        maxLength={2000}
                        placeholder={cell.mode === 'INPUT' ? 'kosong untuk user' : 'isi tetap'}
                        aria-label={`Sel baris ${rowIndex + 1} kolom ${columnIndex + 1}`}
                        onChange={(event) =>
                          updateCell(rowIndex, columnIndex, { value: event.target.value })
                        }
                        className={cn(
                          'w-full rounded border px-2 py-1 text-xs dark:bg-slate-900',
                          cell.mode === 'FIXED'
                            ? 'border-slate-300 dark:border-slate-700'
                            : 'border-dashed border-slate-300 text-slate-500 dark:border-slate-700',
                        )}
                      />
                      <div className="mt-1">
                        <SelectControl
                          value={cell.mode}
                          aria-label={`Jenis isi sel baris ${rowIndex + 1} kolom ${columnIndex + 1}`}
                          onValueChange={(mode) =>
                            mode &&
                            updateCell(rowIndex, columnIndex, {
                              mode: mode as TableCell['mode'],
                            })
                          }
                          options={[
                            { value: 'FIXED', label: 'Tetap dari template' },
                            { value: 'INPUT', label: 'Diisi user' },
                          ]}
                          className="h-7 w-full text-[11px]"
                        />
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {rowCount === 0 && (
          <Alert tone="warning">Tabel belum punya baris. Tambahkan minimal satu baris.</Alert>
        )}
      </div>
    </Modal>
  );
}
