import { Fragment, useState } from 'react';
import {
  DEFAULT_PRICE_PER_MANDAY,
  EFFORT_LEVEL_LABELS,
  EFFORT_LEVELS,
  effortMonths,
  formatDays,
  type DataConfig,
  type EffortLevel,
  type EffortTableSettings,
  type MandayActivityData,
  type MandayEffortData,
  type ProjectData,
} from '@dtrace/shared';
import { Minus, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

/**
 * The two mandays tables a BPM prints, drawn from a snapshot.
 *
 * One renderer for the builder preview, the editor and the print page, so the
 * numbers look the same wherever they are read. Sizes are inherited: the sheet
 * on screen sets its own small type, the print page sets points, and these
 * tables follow whichever they are placed in.
 *
 * The greens are the estimate spreadsheet's, which is what the signed BPMs
 * have always shown.
 */

const cell = 'border border-slate-900 px-[0.45em] py-[0.2em] align-top';
const num = cn(cell, 'text-center tabular-nums');
const HEAD = 'bg-[#00b050] font-bold text-slate-950';
const STAGE = 'bg-[#a9d08e] font-bold';
const GROUP = 'bg-[#e2efda] font-semibold';

export function ProjectDataBlock({
  config,
  data,
  effortTable,
  onEffortTableChange,
  disabled = true,
}: {
  config: DataConfig;
  data: ProjectData | null;
  effortTable?: EffortTableSettings;
  onEffortTableChange?: (settings: EffortTableSettings) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-[0.5em]">
      {config.intro && <p>{config.intro}</p>}
      {!data ? (
        <p className="italic text-slate-500">Data belum tersedia.</p>
      ) : data.dataset === 'MANDAY_EFFORT' ? (
        <EffortTable
          data={data}
          config={config}
          settings={effortTable}
          onChange={onEffortTableChange}
          disabled={disabled}
        />
      ) : (
        <ActivityTable data={data} />
      )}
    </div>
  );
}

export function EffortTable({
  data,
  config,
  settings,
  onChange,
  disabled,
}: {
  data: MandayEffortData;
  config: DataConfig;
  settings?: EffortTableSettings;
  onChange?: (settings: EffortTableSettings) => void;
  disabled: boolean;
}) {
  const [allocationErrors, setAllocationErrors] = useState<Record<string, string>>({});
  const monthCount = settings?.monthCount ?? 3;
  const weeks = monthCount * 4;
  const months = effortMonths(weeks);

  const currentSettings = (): EffortTableSettings => ({
    monthCount,
    levels: settings?.levels ?? {},
    weeks: settings?.weeks ?? {},
    prices: settings?.prices ?? {},
    customRows: settings?.customRows ?? [],
  });

  const update = (next: Partial<EffortTableSettings>) =>
    onChange?.({ ...currentSettings(), ...next });

  const displayRows = [
    ...data.roles.map((role) => ({
      id: `role:${role.role}`,
      roleKey: role.role,
      role: role.label,
      level: settings?.levels[role.role] ?? ('MID' as EffortLevel),
      weeks: settings?.weeks[role.role] ?? [],
      price: settings?.prices[role.role] ?? DEFAULT_PRICE_PER_MANDAY,
      targetTotal: role.total,
      custom: false as const,
    })),
    ...(settings?.customRows ?? []).map((row) => {
      const selectedRole = data.roles.find(
        (role) => role.role === row.role || role.label === row.role,
      );
      return {
        ...row,
        roleKey: selectedRole?.role ?? '',
        role: selectedRole?.label ?? '',
        targetTotal: null,
        custom: true as const,
      };
    }),
  ];
  const rowTotal = (values: (number | null)[]) =>
    Math.round(values.slice(0, weeks).reduce<number>((sum, value) => sum + (value ?? 0), 0) * 1000) / 1000;
  const grandTotal = displayRows.reduce(
    (sum, row) => sum + (row.targetTotal ?? rowTotal(row.weeks)),
    0,
  );
  const grandPrice = displayRows.reduce(
    (sum, row) => sum + (row.targetTotal ?? rowTotal(row.weeks)) * row.price,
    0,
  );
  const resourceCounts = data.roles
    .map((role) => ({
      role: role.role,
      label: role.label,
      count: displayRows.filter((row) => row.roleKey === role.role).length,
    }))
    .filter((resource) => resource.count > 0);

  const patchCustomRow = (
    id: string,
    patch: Partial<NonNullable<EffortTableSettings['customRows']>[number]>,
  ) =>
    update({
      customRows: currentSettings().customRows.map((row) =>
        row.id === id ? { ...row, ...patch } : row,
      ),
    });

  if (data.roles.length === 0) {
    return (
      <p className="italic text-slate-500">
        Belum ada estimasi mandays. Isi menu Mandays pada project ini.
      </p>
    );
  }

  return (
    <div className="space-y-[0.6em]">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold">A. Implementasi :</p>
        {!disabled && (
          <div className="flex items-center gap-1 print:hidden">
            <button
              type="button"
              title="Kurangi bulan"
              aria-label="Kurangi bulan"
              disabled={monthCount <= 1}
              onClick={() => update({ monthCount: Math.max(1, monthCount - 1) })}
              className="rounded border border-slate-300 bg-white p-1 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
            >
              <Minus className="h-3 w-3" aria-hidden />
            </button>
            <span className="min-w-14 text-center text-[9px] text-slate-600">{monthCount} bulan</span>
            <button
              type="button"
              title="Tambah bulan"
              aria-label="Tambah bulan"
              disabled={monthCount >= 12}
              onClick={() => update({ monthCount: Math.min(12, monthCount + 1) })}
              className="rounded border border-slate-300 bg-white p-1 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
            >
              <Plus className="h-3 w-3" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() =>
                update({
                  customRows: [
                    ...currentSettings().customRows,
                    {
                      id: crypto.randomUUID(),
                      role: '',
                      level: 'MID',
                      weeks: [],
                      price: DEFAULT_PRICE_PER_MANDAY,
                    },
                  ],
                })
              }
              className="ml-1 inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-1.5 py-1 text-[9px] font-medium text-slate-700 hover:bg-slate-50"
            >
              <Plus className="h-3 w-3" aria-hidden />
              Tambah baris
            </button>
          </div>
        )}
      </div>
      <div className="overflow-x-auto print:overflow-visible">
        <table className="min-w-max w-full border-collapse text-[0.9em]">
          <thead>
            <tr>
              <th rowSpan={2} className={cn(cell, HEAD, 'min-w-28 text-left')}>
                Role
              </th>
              <th rowSpan={2} className={cn(cell, HEAD, 'min-w-32 text-left')}>
                Level
              </th>
              {months.map((month) => (
                <th key={month.month} colSpan={month.weeks} className={cn(num, HEAD)}>
                  Month {month.month}
                </th>
              ))}
              <th rowSpan={2} className={cn(num, HEAD)}>
                Total
              </th>
              <th rowSpan={2} className={cn(num, HEAD, 'min-w-28')}>Price / Mandays</th>
              <th rowSpan={2} className={cn(num, HEAD, 'min-w-28')}>Total Price</th>
            </tr>
            <tr>
              {Array.from({ length: weeks }, (_, index) => (
                <th key={index} className={cn(num, HEAD, 'min-w-9 font-semibold')}>
                  W{(index % 4) + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayRows.map((row) => {
              const allocated = rowTotal(row.weeks);
              const total = row.targetTotal ?? allocated;
              const remaining = row.targetTotal === null ? null : Math.round((total - allocated) * 1000) / 1000;
              return (
                <tr key={row.id}>
                  <td className={cn(cell, 'whitespace-nowrap')}>
                    {row.custom && !disabled ? (
                      <div className="flex items-center gap-1">
                        <select
                          aria-label="Role baru"
                          value={row.roleKey}
                          onChange={(event) => patchCustomRow(row.id, { role: event.target.value })}
                          className="min-w-24 flex-1 border-0 bg-transparent p-0 text-[inherit] outline-none"
                        >
                          <option value="">Pilih role</option>
                          {data.roles.map((role) => (
                            <option key={role.role} value={role.role}>{role.label}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          title="Hapus baris"
                          aria-label={`Hapus baris ${row.role || 'baru'}`}
                          onClick={() =>
                            update({
                              customRows: currentSettings().customRows.filter((item) => item.id !== row.id),
                            })
                          }
                          className="text-slate-400 hover:text-red-600"
                        >
                          <Trash2 className="h-3 w-3" aria-hidden />
                        </button>
                      </div>
                    ) : (
                      row.role
                    )}
                  </td>
                  <td className={cell}>
                    {disabled ? (
                      EFFORT_LEVEL_LABELS[row.level]
                    ) : (
                      <select
                        aria-label={`Level ${row.role || 'role baru'}`}
                        value={row.level}
                        onChange={(event) => {
                          const level = event.target.value as EffortLevel;
                          if (row.custom) patchCustomRow(row.id, { level });
                          else update({ levels: { ...currentSettings().levels, [row.roleKey]: level } });
                        }}
                        className="w-full min-w-32 border-0 bg-transparent p-0 text-[inherit] outline-none"
                      >
                        {EFFORT_LEVELS.map((item) => (
                          <option key={item} value={item}>{EFFORT_LEVEL_LABELS[item]}</option>
                        ))}
                      </select>
                    )}
                  </td>
                  {Array.from({ length: weeks }, (_, index) => {
                    const value = row.weeks[index] ?? null;
                    return (
                      <td key={index} className={cn(num, value !== null && value > 0 && 'bg-[#c6efce]')}>
                        {disabled ? (
                          value === null ? '' : formatDays(value)
                        ) : (
                          <input
                            type="number"
                            min="0"
                            max={row.targetTotal ?? undefined}
                            step="0.125"
                            aria-label={`${row.role || 'Role baru'} Month ${Math.floor(index / 4) + 1} W${(index % 4) + 1}`}
                            value={value ?? ''}
                            onFocus={(event) => event.currentTarget.select()}
                            onChange={(event) => {
                              const nextWeeks = [...row.weeks];
                              const requested = event.target.value === '' ? null : event.target.valueAsNumber;
                              nextWeeks[index] = requested;
                              const nextAllocated = rowTotal(nextWeeks);
                              if (
                                row.targetTotal !== null &&
                                Number.isFinite(nextAllocated) &&
                                nextAllocated > row.targetTotal
                              ) {
                                const otherAllocated = rowTotal(
                                  row.weeks.map((week, weekIndex) => weekIndex === index ? null : week),
                                );
                                const available = Math.max(0, row.targetTotal - otherAllocated);
                                nextWeeks[index] = available;
                                setAllocationErrors((errors) => ({
                                  ...errors,
                                  [row.id]: `Nilai disesuaikan menjadi ${formatDays(available)}. Total alokasi tidak boleh melebihi ${formatDays(row.targetTotal)} mandays.`,
                                }));
                              } else {
                                setAllocationErrors((errors) => {
                                  const next = { ...errors };
                                  delete next[row.id];
                                  return next;
                                });
                              }
                              if (row.custom) patchCustomRow(row.id, { weeks: nextWeeks });
                              else update({ weeks: { ...currentSettings().weeks, [row.roleKey]: nextWeeks } });
                            }}
                            className="w-9 border-0 bg-transparent p-0 text-center text-[inherit] outline-none"
                          />
                        )}
                      </td>
                    );
                  })}
                  <td className={cn(num, 'min-w-20 font-semibold')}>
                    <div>{formatDays(total)}</div>
                    {remaining !== null && !disabled && (
                      <div
                        className={cn(
                          'mt-0.5 whitespace-nowrap text-[8px] font-normal',
                          remaining === 0 ? 'text-emerald-700' : 'text-amber-700',
                        )}
                      >
                        {remaining === 0 ? 'Alokasi lengkap' : `Sisa ${formatDays(Math.max(0, remaining))}`}
                      </div>
                    )}
                    {allocationErrors[row.id] && (
                      <div className="mt-0.5 max-w-32 whitespace-normal text-left text-[8px] font-normal text-red-600">
                        {allocationErrors[row.id]}
                      </div>
                    )}
                  </td>
                  <td className={num}>
                    {disabled ? (
                      formatPrice(row.price)
                    ) : (
                      <input
                        type="number"
                        min="0"
                        step="50000"
                        aria-label={`Price per mandays ${row.role || 'role baru'}`}
                        value={row.price}
                        onChange={(event) => {
                          const price = event.target.valueAsNumber || 0;
                          if (row.custom) patchCustomRow(row.id, { price });
                          else update({ prices: { ...currentSettings().prices, [row.roleKey]: price } });
                        }}
                        className="w-28 border-0 bg-transparent p-0 text-right text-[inherit] outline-none"
                      />
                    )}
                  </td>
                  <td className={cn(num, 'font-semibold')}>{formatPrice(total * row.price)}</td>
                </tr>
              );
            })}
            <tr>
              <td className={cn(cell, HEAD, 'text-right')} colSpan={weeks + 2}>
                Total Mandays
              </td>
              <td className={cn(num, HEAD)}>{formatDays(grandTotal)}</td>
              <td className={cn(cell, HEAD)} />
              <td className={cn(num, HEAD)}>{formatPrice(grandPrice)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {config.showResources && (
        <div>
          <p className="font-semibold">B. Resource yang dibutuhkan :</p>
          {resourceCounts.length === 0 ? (
            <p className="pl-[1.2em] italic text-slate-500">Belum ada role pada tabel Implementasi.</p>
          ) : (
            <ul className="pl-[1.2em]">
              {resourceCounts.map((resource) => (
                <li key={resource.role}>
                  - {resource.count} {resource.label}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function formatPrice(value: number): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function ActivityTable({ data }: { data: MandayActivityData }) {
  if (data.rows.length === 0) {
    return (
      <p className="italic text-slate-500">
        Belum ada estimasi mandays. Isi menu Mandays pada project ini.
      </p>
    );
  }

  const span = data.roles.length + 2;

  return (
    <div className="overflow-x-auto print:overflow-visible">
      <table className="w-full border-collapse text-[0.9em]">
        <thead>
          <tr>
            <th rowSpan={2} className={cn(cell, HEAD, 'text-center align-middle')}>
              Task Name
            </th>
            <th colSpan={data.roles.length + 1} className={cn(num, HEAD)}>
              Mandays
            </th>
          </tr>
          <tr>
            {data.roles.map((role) => (
              <th key={role.role} className={cn(num, HEAD, 'w-[11%]')}>
                {role.label}
              </th>
            ))}
            <th className={cn(num, HEAD, 'w-[11%]')}>Total</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, index) => (
            <Fragment key={index}>
              {row.kind === 'stage' ? (
                <tr className="break-inside-avoid">
                  <td colSpan={span} className={cn(cell, STAGE, 'text-center')}>
                    {row.name}
                  </td>
                </tr>
              ) : (
                <tr className="break-inside-avoid">
                  <td
                    className={cn(cell, row.kind === 'group' && GROUP)}
                    style={{ paddingLeft: `${0.45 + row.depth * 1}em` }}
                  >
                    {row.name}
                  </td>
                  {data.roles.map((role) => (
                    <td
                      key={role.role}
                      className={cn(num, row.kind === 'group' && GROUP)}
                    >
                      {formatDays(row.efforts[role.role] ?? 0)}
                    </td>
                  ))}
                  <td className={cn(num, 'font-semibold', row.kind === 'group' && GROUP)}>
                    {formatDays(row.total)}
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
          <tr className="break-inside-avoid">
            <td className={cn(cell, HEAD, 'text-center')}>Total Mandays</td>
            {data.roles.map((role) => (
              <td key={role.role} className={cn(num, HEAD)}>
                {formatDays(data.totals.byRole[role.role] ?? 0)}
              </td>
            ))}
            <td className={cn(num, HEAD)}>{formatDays(data.totals.total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** Numbers for the builder preview, so a designer sees the table's shape. */
export const SAMPLE_PROJECT_DATA: Record<ProjectData['dataset'], ProjectData> = {
  MANDAY_EFFORT: {
    dataset: 'MANDAY_EFFORT',
    startsOn: '2026-01-05',
    weekCount: 8,
    roles: [
      { role: 'BA', label: 'Business Analyst', weeks: [5, 5, 2, 2, 2, 2, 3, 2], total: 23 },
      { role: 'DEVELOPER', label: 'Developer', weeks: [0, 3, 5, 5, 5, 5, 4, 2], total: 29 },
      { role: 'QA', label: 'QA', weeks: [0, 0, 0, 2, 3, 5, 5, 2], total: 17 },
    ],
    total: 69,
    unscheduled: 0,
    resources: [
      { role: 'BA', label: 'Business Analyst', count: 1 },
      { role: 'DEVELOPER', label: 'Developer', count: 2 },
      { role: 'QA', label: 'QA', count: 1 },
    ],
  },
  MANDAY_ACTIVITY: {
    dataset: 'MANDAY_ACTIVITY',
    roles: [
      { role: 'BA', label: 'Business Analyst' },
      { role: 'DEVELOPER', label: 'Developer' },
      { role: 'QA', label: 'QA' },
    ],
    rows: [
      { kind: 'stage', name: 'Prepare', depth: 0, efforts: { BA: 5, DEVELOPER: 0, QA: 0 }, total: 5 },
      { kind: 'task', name: 'Kick Off Meeting', depth: 0, efforts: { BA: 1, DEVELOPER: 0, QA: 0 }, total: 1 },
      { kind: 'task', name: 'User Requirement (BPM, Blueprint)', depth: 0, efforts: { BA: 4, DEVELOPER: 0, QA: 0 }, total: 4 },
      { kind: 'stage', name: 'Develop', depth: 0, efforts: { BA: 0.5, DEVELOPER: 4, QA: 1 }, total: 5.5 },
      { kind: 'group', name: 'Menu Master Jabatan', depth: 0, efforts: { BA: 0.5, DEVELOPER: 4, QA: 1 }, total: 5.5 },
      { kind: 'task', name: 'Table view Menu Master Jabatan', depth: 1, efforts: { BA: 0.25, DEVELOPER: 1, QA: 0.5 }, total: 1.75 },
      { kind: 'task', name: 'Popup Edit Jobdesk', depth: 1, efforts: { BA: 0.25, DEVELOPER: 3, QA: 0.5 }, total: 3.75 },
    ],
    totals: { byRole: { BA: 5.5, DEVELOPER: 4, QA: 1 }, total: 10.5 },
  },
};
