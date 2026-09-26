import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/**
 * Prisma 7 reads CLI configuration from here instead of from the schema, so the
 * connection string lives in exactly one place: the DATABASE_URL env var.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env['DATABASE_URL'],
  },
});
