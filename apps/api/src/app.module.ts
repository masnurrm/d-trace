import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { SENSITIVE_KEYS } from '@dtrace/shared';
import { loadConfiguration, type AppConfig } from './config/configuration.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { ResponseInterceptor } from './common/interceptors/response.interceptor.js';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard.js';
import { RolesGuard } from './common/guards/roles.guard.js';
import { UserThrottlerGuard } from './common/guards/user-throttler.guard.js';
import { OriginCheckMiddleware } from './common/middleware/origin-check.middleware.js';
import { PrismaModule } from './modules/prisma/prisma.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { HierarchyModule } from './modules/hierarchy/hierarchy.module.js';
import { DocumentTemplatesModule } from './modules/document-templates/document-templates.module.js';
import { WorkspaceModule } from './modules/workspace/workspace.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { PermissionsModule } from './modules/permissions/permissions.module.js';
import { SettingsModule } from './modules/settings/settings.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { HolidaysModule } from './modules/holidays/holidays.module.js';
import { InvitationsModule } from './modules/invitations/invitations.module.js';

/**
 * Composition root.
 *
 * The global provider order below is the security posture of the whole API:
 *
 *   1. JwtAuthGuard        - authenticate (deny by default, `@Public()` opts out);
 *   2. UserThrottlerGuard  - rate limit, keyed by user id once we know who it is;
 *   3. RolesGuard          - authorize (`@Roles()` / `@MinRole()`).
 *
 * Nest runs global guards in registration order. Authentication deliberately
 * comes first: the API's only caller is the BFF, so every authenticated request
 * shares one source address, and limiting by address would let one session
 * throttle everyone. Identity has to be known before the budget can be charged
 * to the right account.
 *
 * The cost of that ordering is that a flood of *invalid* tokens reaches JWT
 * verification before the limiter. That is an HMAC comparison with no database
 * access, and coarse per-address limiting belongs at the edge proxy anyway
 * (see docs/SECURITY.md).
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [loadConfiguration],
      // .env is for local development only; real deployments inject real env vars.
      envFilePath: ['.env.local', '.env'],
    }),

    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => ({
        pinoHttp: {
          level: config.get('log', { infer: true }).level,
          // Every request gets an id; it is echoed in the response envelope so a
          // user-reported error maps to exactly one log line.
          genReqId: (req, res) => {
            const existing = req.headers['x-request-id'];
            const id = typeof existing === 'string' && existing.length <= 128 ? existing : randomUUID();
            res.setHeader('x-request-id', id);
            return id;
          },
          transport: config.get('isProduction', { infer: true })
            ? undefined
            : { target: 'pino-pretty', options: { singleLine: true, translateTime: 'SYS:HH:MM:ss' } },
          // Headers and bodies routinely contain credentials. Redact centrally.
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'res.headers["set-cookie"]',
              ...SENSITIVE_KEYS.map((key) => `req.body.${key}`),
            ],
            censor: '[REDACTED]',
          },
          autoLogging: {
            ignore: (req) => req.url?.startsWith('/api/v1/health') ?? false,
          },
        },
      }),
    }),

    ThrottlerModule.forRootAsync({
      imports: [],
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => {
        const throttle = config.get('throttle', { infer: true });
        // Exactly one throttler. Routes that need a tighter budget override it
        // with `@Throttle({ default: … })`, which replaces the limit for that
        // handler only. Registering a second named throttler here would apply
        // it to every route in the API, not just the ones that reference it.
        return {
          throttlers: [
            { name: 'default', ttl: throttle.ttlSeconds * 1000, limit: throttle.limit },
          ],
        };
      },
    }),

    PrismaModule,
    AuditModule,
    AuthModule,
    UsersModule,
    HierarchyModule,
    PermissionsModule,
    DocumentTemplatesModule,
    WorkspaceModule,
    NotificationsModule,
    SettingsModule,
    HealthModule,
    HolidaysModule,
    InvitationsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: UserThrottlerGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Express 5 wildcard syntax; `*` alone is no longer a valid path pattern.
    consumer.apply(OriginCheckMiddleware).forRoutes('{*splat}');
  }
}
