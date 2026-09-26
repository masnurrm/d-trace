import { z } from 'zod';

const durationString = z
  .string()
  .regex(/^\d+(ms|s|m|h|d)$/, 'Use a duration like 15m, 24h or 7d');

const csv = (value: string): string[] =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

/**
 * The process refuses to boot unless every one of these is satisfiable.
 * Fail-fast beats discovering a missing secret at the first login attempt.
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    /** '::' listens on IPv6 and IPv4; '127.0.0.1' restricts to this machine. */
    HOST: z.string().default('::'),
    APP_NAME: z.string().default('D-Trace API'),
    API_PREFIX: z.string().default('api'),
    API_VERSION: z.string().default('1'),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

    /** Comma-separated exact origins. No wildcard support, by design. */
    CORS_ORIGINS: z.string().default('http://localhost:3000'),

    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
    JWT_ACCESS_TTL: durationString.default('15m'),
    JWT_REFRESH_TTL: durationString.default('7d'),
    JWT_ISSUER: z.string().default('dtrace'),
    JWT_AUDIENCE: z.string().default('dtrace-web'),

    COOKIE_SECRET: z.string().min(32, 'COOKIE_SECRET must be at least 32 characters'),
    /** Encrypts stored settings secrets (currently the SMTP password). */
    SETTINGS_SECRET: z.string().min(32, 'SETTINGS_SECRET must be at least 32 characters'),
    COOKIE_DOMAIN: z.string().optional(),
    COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),

    /** Account lockout after repeated failures, in attempts / minutes. */
    MAX_FAILED_LOGINS: z.coerce.number().int().min(1).max(50).default(5),
    LOCKOUT_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),

    THROTTLE_TTL_SECONDS: z.coerce.number().int().min(1).default(60),
    /** Per authenticated user, per window - not per process. */
    THROTTLE_LIMIT: z.coerce.number().int().min(1).default(300),

    /** Set only when running behind a proxy you control (it trusts XFF). */
    TRUST_PROXY: z.enum(['true', 'false']).default('false'),
    BODY_LIMIT: z.string().default('1mb'),
    /** Where uploaded document files are written. Relative to the API's cwd. */
    UPLOAD_DIR: z.string().default('./storage/uploads'),
    /** Largest single upload, in bytes. Default 15 MB. */
    UPLOAD_MAX_BYTES: z.coerce.number().int().min(1024).max(200 * 1024 * 1024).default(15 * 1024 * 1024),

    /** Injected by the build; shown read-only in Settings. */
    APP_VERSION: z.string().optional(),
    GIT_SHA: z.string().optional(),

    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    SWAGGER_ENABLED: z.enum(['true', 'false']).default('true'),

    SEED_ADMIN_EMAIL: z.string().optional(),
    SEED_ADMIN_PASSWORD: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;

    if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_REFRESH_SECRET'],
        message: 'Access and refresh secrets must differ in production',
      });
    }
    if (env.COOKIE_SAME_SITE === 'none') {
      ctx.addIssue({
        code: 'custom',
        path: ['COOKIE_SAME_SITE'],
        message: 'SameSite=None weakens CSRF protection; use lax or strict in production',
      });
    }
    if (env.SWAGGER_ENABLED === 'true') {
      ctx.addIssue({
        code: 'custom',
        path: ['SWAGGER_ENABLED'],
        message: 'Do not expose Swagger in production',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export { csv };
