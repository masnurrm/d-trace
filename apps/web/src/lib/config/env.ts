import { z } from 'zod';

/**
 * Server-only configuration.
 *
 * Nothing here may be prefixed `NEXT_PUBLIC_`: the API base URL, and anything
 * else in this file, is read exclusively by server components, route handlers
 * and middleware. The browser talks to this app, never to the API directly.
 */
const serverEnvSchema = z.object({
  API_URL: z.string().url().default('http://localhost:4000'),
  /**
   * Where the browser opens the notification socket. Separate from API_URL
   * because the browser may reach the API through a different hostname than
   * this server does — a container name is not resolvable from a laptop.
   */
  SOCKET_URL: z.string().url().optional(),
  API_PREFIX: z.string().default('api'),
  API_VERSION: z.string().default('1'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

const parsed = serverEnvSchema.safeParse({
  API_URL: process.env.API_URL,
  SOCKET_URL: process.env.SOCKET_URL,
  API_PREFIX: process.env.API_PREFIX,
  API_VERSION: process.env.API_VERSION,
  NODE_ENV: process.env.NODE_ENV,
});

if (!parsed.success) {
  throw new Error(
    `Invalid web environment:\n${parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n')}`,
  );
}

export const serverEnv = parsed.data;

export const isProduction = serverEnv.NODE_ENV === 'production';

/** `http://localhost:4000/api/v1` */
export const apiBaseUrl = `${serverEnv.API_URL.replace(/\/$/, '')}/${serverEnv.API_PREFIX}/v${serverEnv.API_VERSION}`;

/**
 * The socket origin handed to the browser, defaulting to the API URL.
 *
 * This is the one address the browser is told about, and it buys exactly one
 * thing: a push instead of a poll. Everything else still goes through the BFF.
 */
export const socketUrl = serverEnv.SOCKET_URL ?? serverEnv.API_URL.replace(/\/$/, '');
