import { z } from 'zod';

/**
 * Days nobody works, so a schedule can step over them.
 *
 * The timeline already skips weekends, which are true everywhere. Public
 * holidays are not: they differ by country and move year to year, so they are
 * data rather than a rule in code — and until somebody imports them, the
 * schedule is honest about only knowing about weekends.
 */

export const HOLIDAY_SOURCES = ['IMPORTED', 'MANUAL'] as const;
export type HolidaySource = (typeof HOLIDAY_SOURCES)[number];

export const HOLIDAY_SOURCE_LABELS: Record<HolidaySource, string> = {
  IMPORTED: 'Dari kalender publik',
  MANUAL: 'Ditambahkan manual',
};

/** ISO 3166-1 alpha-2, upper case. The sync API keys on it. */
export const countryCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .length(2, 'Kode negara harus 2 huruf');

/** A bare date, `YYYY-MM-DD`. A holiday has no time of day. */
export const holidayDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Tanggal harus berformat YYYY-MM-DD');

export const listHolidaysQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  countryCode: countryCodeSchema.default('ID'),
});

export type ListHolidaysQuery = z.infer<typeof listHolidaysQuerySchema>;

export const syncHolidaysSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  countryCode: countryCodeSchema.default('ID'),
});

export type SyncHolidaysInput = z.infer<typeof syncHolidaysSchema>;

export const createHolidaySchema = z.object({
  date: holidayDateSchema,
  name: z.string().trim().min(2, 'Nama hari libur minimal 2 karakter').max(120),
  countryCode: countryCodeSchema.default('ID'),
});

export type CreateHolidayInput = z.infer<typeof createHolidaySchema>;

export interface HolidayView {
  id: string;
  /** `YYYY-MM-DD`. */
  date: string;
  name: string;
  countryCode: string;
  source: HolidaySource;
}

export interface HolidaySyncResult {
  year: number;
  countryCode: string;
  imported: number;
  /** Rows the sync left alone because somebody added them by hand. */
  keptManual: number;
}

/** Saturday and Sunday, true wherever the project runs. */
export function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

/**
 * Whether a day is worked, given the holidays that have been imported.
 *
 * Takes the holiday set rather than reaching for it, so the same function
 * decides the shading in the chart and the arithmetic in the scheduler — two
 * places that disagreeing about a Tuesday would be very hard to notice.
 */
export function isWorkingDay(date: Date, holidays: ReadonlySet<string>): boolean {
  if (isWeekend(date)) return false;
  return !holidays.has(toDateKey(date));
}

/** `YYYY-MM-DD` in local time — the same key the holiday table uses. */
export function toDateKey(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}
