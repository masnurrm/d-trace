import { envSchema, csv, type Env } from './env.schema.js';
import { resolveVersion } from '../common/utils/version.js';

export interface AppConfig {
  nodeEnv: Env['NODE_ENV'];
  isProduction: boolean;
  appName: string;
  port: number;
  host: string;
  apiPrefix: string;
  apiVersion: string;
  corsOrigins: string[];
  bodyLimit: string;
  upload: { dir: string; maxBytes: number };
  trustProxy: boolean;
  database: { url: string };
  jwt: {
    accessSecret: string;
    refreshSecret: string;
    accessTtl: string;
    refreshTtl: string;
    issuer: string;
    audience: string;
  };
  version: string;
  settingsSecret: string;
  cookie: {
    secret: string;
    domain?: string;
    sameSite: 'lax' | 'strict' | 'none';
    secure: boolean;
  };
  security: { maxFailedLogins: number; lockoutMinutes: number };
  throttle: { ttlSeconds: number; limit: number };
  log: { level: Env['LOG_LEVEL'] };
  swagger: { enabled: boolean };
}

/**
 * Parses `process.env` once at boot and hands back a typed, immutable tree.
 * Nothing else in the codebase may read `process.env` directly.
 */
export function loadConfiguration(): AppConfig {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  const env = parsed.data;
  const isProduction = env.NODE_ENV === 'production';

  return {
    nodeEnv: env.NODE_ENV,
    isProduction,
    appName: env.APP_NAME,
    port: env.PORT,
    host: env.HOST,
    apiPrefix: env.API_PREFIX,
    apiVersion: env.API_VERSION,
    corsOrigins: csv(env.CORS_ORIGINS),
    bodyLimit: env.BODY_LIMIT,
    upload: { dir: env.UPLOAD_DIR, maxBytes: env.UPLOAD_MAX_BYTES },
    trustProxy: env.TRUST_PROXY === 'true',
    database: { url: env.DATABASE_URL },
    jwt: {
      accessSecret: env.JWT_ACCESS_SECRET,
      refreshSecret: env.JWT_REFRESH_SECRET,
      accessTtl: env.JWT_ACCESS_TTL,
      refreshTtl: env.JWT_REFRESH_TTL,
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    },
    version: resolveVersion(env.APP_VERSION, env.GIT_SHA),
    settingsSecret: env.SETTINGS_SECRET,
    cookie: {
      secret: env.COOKIE_SECRET,
      domain: env.COOKIE_DOMAIN,
      sameSite: env.COOKIE_SAME_SITE,
      /** Secure cookies require HTTPS, which local development does not have. */
      secure: isProduction,
    },
    security: {
      maxFailedLogins: env.MAX_FAILED_LOGINS,
      lockoutMinutes: env.LOCKOUT_MINUTES,
    },
    throttle: {
      ttlSeconds: env.THROTTLE_TTL_SECONDS,
      limit: env.THROTTLE_LIMIT,
    },
    log: { level: env.LOG_LEVEL },
    swagger: { enabled: env.SWAGGER_ENABLED === 'true' && !isProduction },
  };
}

