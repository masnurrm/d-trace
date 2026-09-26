import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { pathToFileURL } from 'node:url';
import { PrismaClient } from '../src/generated/prisma/client.js';

/**
 * The one database connection the seeders share.
 *
 * `npm run db:seed` runs three of them in a row, and each opening its own
 * client would leave two of the three connected and idle until the process
 * ended — and, worse, would make a seeder that imports another silently open a
 * second pool. One client, disconnected once, by whoever started the run.
 */
const connectionString = process.env['DATABASE_URL'];
if (!connectionString) throw new Error('DATABASE_URL is not set.');

export const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

/**
 * True when this module is the file Node was asked to run.
 *
 * Every seeder is both a step of `db:seed` and a script in its own right, so it
 * cannot simply call itself at import time: doing so would fire the moment
 * another seeder imported it. `import.meta.url` against `argv[1]` is the ESM
 * way of asking "was I run, or was I read".
 */
export function isEntryPoint(moduleUrl: string): boolean {
  const invoked = process.argv[1];
  return invoked !== undefined && pathToFileURL(invoked).href === moduleUrl;
}

/**
 * Runs a seeder as a standalone script: report the failure, set a non-zero
 * exit code so CI notices, and let the connection go either way.
 */
export function runAsScript(work: () => Promise<void>): void {
  work()
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => {
      void prisma.$disconnect();
    });
}
