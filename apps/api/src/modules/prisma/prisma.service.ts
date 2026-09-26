import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import type { AppConfig } from '../../config/configuration.js';
import { PrismaClient } from '../../generated/prisma/client.js';

/**
 * The only object in the app that talks to Postgres.
 *
 * Prisma 7 connects through a driver adapter, so the pool is plain `pg` and the
 * connection string is injected from validated config rather than read out of
 * `process.env` by the client - an unset DATABASE_URL fails at boot with a
 * readable message instead of at the first query.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: ConfigService<AppConfig, true>) {
    super({
      adapter: new PrismaPg({ connectionString: config.get('database', { infer: true }).url }),
      // Query-level logging is off even in development: queries carry parameter
      // values, and those are exactly the things that must not reach a log file.
      log: ['warn', 'error'],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Database connection established');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Used by the readiness probe; cheap and index-free. */
  async ping(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }
}
