import { Injectable, Logger } from '@nestjs/common';
import {
  AUDIT_ACTIONS,
  type CreateHolidayInput,
  type HolidaySource,
  type HolidaySyncResult,
  type HolidayView,
  type ListHolidaysQuery,
  type SyncHolidaysInput,
} from '@dtrace/shared';
import { AppException } from '../../common/exceptions/app.exception.js';
import type { ClientInfo } from '../../common/decorators/client-info.decorator.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-request.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** The public-holiday calendar the sync button reads. */
const SOURCE_URL = (year: number, countryCode: string) =>
  `https://date.nager.at/api/v3/PublicHolidays/${year}/${countryCode}`;

/** A slow or hanging third party must not hold a request open indefinitely. */
const SYNC_TIMEOUT_MS = 10_000;

interface NagerHoliday {
  date: string;
  localName: string;
  name: string;
}

const toKey = (date: Date) => date.toISOString().slice(0, 10);

/**
 * Non-working days, per country.
 *
 * Weekends are a rule and live in code; public holidays are data — they differ
 * by country and move every year, so they are imported rather than hard-coded.
 * Until somebody runs the sync the schedule knows only about weekends, which is
 * wrong in a way the screen states rather than hides.
 */
@Injectable()
export class HolidaysService {
  private readonly logger = new Logger(HolidaysService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListHolidaysQuery): Promise<HolidayView[]> {
    const rows = await this.prisma.holiday.findMany({
      where: {
        countryCode: query.countryCode,
        date: {
          gte: new Date(Date.UTC(query.year, 0, 1)),
          lte: new Date(Date.UTC(query.year, 11, 31)),
        },
      },
      orderBy: { date: 'asc' },
    });

    return rows.map(toView);
  }

  /**
   * Replaces the imported holidays for one year, leaving manual ones alone.
   *
   * Wholesale rather than merged: the calendar is the upstream's answer, and a
   * date it dropped this year is a date that should stop being a holiday here
   * too. Rows somebody added by hand are a different kind of fact and survive.
   */
  async sync(
    input: SyncHolidaysInput,
    actor: AuthenticatedUser,
    client: ClientInfo,
  ): Promise<HolidaySyncResult> {
    const holidays = await this.fetchUpstream(input.year, input.countryCode);

    const range = {
      gte: new Date(Date.UTC(input.year, 0, 1)),
      lte: new Date(Date.UTC(input.year, 11, 31)),
    };

    const keptManual = await this.prisma.holiday.count({
      where: { countryCode: input.countryCode, date: range, source: 'MANUAL' },
    });

    const manualDates = new Set(
      (
        await this.prisma.holiday.findMany({
          where: { countryCode: input.countryCode, date: range, source: 'MANUAL' },
          select: { date: true },
        })
      ).map((row) => toKey(row.date)),
    );

    const incoming = holidays.filter((holiday) => !manualDates.has(holiday.date));

    const imported = await this.prisma.$transaction(async (tx) => {
      await tx.holiday.deleteMany({
        where: { countryCode: input.countryCode, date: range, source: 'IMPORTED' },
      });

      const result = await tx.holiday.createMany({
        data: incoming.map((holiday) => ({
          date: new Date(`${holiday.date}T00:00:00.000Z`),
          // The local name is what a reader here recognises; the English one
          // is what the API calls it, and is no use on an Indonesian calendar.
          name: holiday.localName || holiday.name,
          countryCode: input.countryCode,
          source: 'IMPORTED' as HolidaySource,
          createdById: actor.id,
        })),
      });

      return result.count;
    });

    await this.audit.record({
      action: AUDIT_ACTIONS.HOLIDAYS_SYNCED,
      entity: 'Holiday',
      entityId: null,
      actorId: actor.id,
      actorEmail: actor.email,
      ip: client.ip,
      userAgent: client.userAgent,
      metadata: { year: input.year, countryCode: input.countryCode, imported, keptManual },
    });

    return { year: input.year, countryCode: input.countryCode, imported, keptManual };
  }

  async create(
    input: CreateHolidayInput,
    actor: AuthenticatedUser,
    client: ClientInfo,
  ): Promise<HolidayView> {
    const date = new Date(`${input.date}T00:00:00.000Z`);

    const clash = await this.prisma.holiday.findUnique({
      where: { countryCode_date: { countryCode: input.countryCode, date } },
      select: { id: true },
    });
    if (clash) throw AppException.conflict('Tanggal itu sudah terdaftar sebagai hari libur');

    const row = await this.prisma.holiday.create({
      data: {
        date,
        name: input.name,
        countryCode: input.countryCode,
        source: 'MANUAL',
        createdById: actor.id,
      },
    });

    await this.audit.record({
      action: AUDIT_ACTIONS.HOLIDAY_CREATED,
      entity: 'Holiday',
      entityId: row.id,
      actorId: actor.id,
      actorEmail: actor.email,
      ip: client.ip,
      userAgent: client.userAgent,
      after: { date: toKey(row.date), name: row.name, countryCode: row.countryCode, source: row.source },
    });

    return toView(row);
  }

  async remove(id: string, actor: AuthenticatedUser, client: ClientInfo): Promise<void> {
    const row = await this.prisma.holiday.findUnique({ where: { id } });
    if (!row) throw AppException.notFound('Hari libur');

    await this.prisma.holiday.delete({ where: { id } });

    await this.audit.record({
      action: AUDIT_ACTIONS.HOLIDAY_DELETED,
      entity: 'Holiday',
      entityId: id,
      actorId: actor.id,
      actorEmail: actor.email,
      ip: client.ip,
      userAgent: client.userAgent,
      before: { date: toKey(row.date), name: row.name, countryCode: row.countryCode, source: row.source },
    });
  }

  /**
   * The dates a scheduler should skip, as `YYYY-MM-DD` keys.
   *
   * A set rather than a list because the caller asks "is this day a holiday"
   * once per day of a project, and a linear scan per question would turn a
   * six-month schedule into thousands of comparisons.
   */
  async keysForRange(from: Date, to: Date, countryCode = 'ID'): Promise<string[]> {
    const rows = await this.namedForRange(from, to, countryCode);
    return rows.map((row) => row.date);
  }

  /** The same range, with the name each date carries. */
  async namedForRange(
    from: Date,
    to: Date,
    countryCode = 'ID',
  ): Promise<{ date: string; name: string }[]> {
    const rows = await this.prisma.holiday.findMany({
      where: { countryCode, date: { gte: from, lte: to } },
      orderBy: { date: 'asc' },
      select: { date: true, name: true },
    });

    return rows.map((row) => ({ date: toKey(row.date), name: row.name }));
  }

  private async fetchUpstream(year: number, countryCode: string): Promise<NagerHoliday[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SYNC_TIMEOUT_MS);

    try {
      const response = await fetch(SOURCE_URL(year, countryCode), {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        throw AppException.conflict(
          `Kalender publik menolak permintaan (${response.status}). Coba lagi nanti.`,
        );
      }

      const payload: unknown = await response.json();
      if (!Array.isArray(payload)) throw AppException.conflict('Kalender publik mengirim data tidak dikenal');

      // Only the three fields used are kept, and each is checked: this is a
      // third party's JSON, not something this app controls the shape of.
      return payload.filter(
        (entry): entry is NagerHoliday =>
          typeof entry === 'object' &&
          entry !== null &&
          typeof (entry as NagerHoliday).date === 'string' &&
          /^\d{4}-\d{2}-\d{2}$/.test((entry as NagerHoliday).date),
      );
    } catch (error) {
      if (error instanceof AppException) throw error;

      this.logger.error({ err: error, year, countryCode }, 'Holiday sync failed');
      throw AppException.conflict(
        'Kalender publik tidak dapat dihubungi. Periksa koneksi internet server lalu coba lagi.',
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

interface HolidayRow {
  id: string;
  date: Date;
  name: string;
  countryCode: string;
  source: string;
}

function toView(row: HolidayRow): HolidayView {
  return {
    id: row.id,
    date: toKey(row.date),
    name: row.name,
    countryCode: row.countryCode,
    source: row.source as HolidaySource,
  };
}
