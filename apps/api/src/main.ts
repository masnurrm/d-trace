import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import type { AppConfig } from './config/configuration.js';

/**
 * Bootstrap order matters: security middleware is installed before routing, so
 * a request cannot reach a handler without having passed through it.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Buffer until pino is wired up, so early boot logs are not lost.
    bufferLogs: true,
  });

  app.useLogger(app.get(Logger));

  const config = app.get(ConfigService<AppConfig, true>);
  const port = config.get('port', { infer: true });
  const apiPrefix = config.get('apiPrefix', { infer: true });
  const apiVersion = config.get('apiVersion', { infer: true });
  const corsOrigins = config.get('corsOrigins', { infer: true });
  const isProduction = config.get('isProduction', { infer: true });

  // Only trust X-Forwarded-* when we know a proxy we control sits in front;
  // otherwise any client could spoof its own IP past the rate limiter.
  app.set('trust proxy', config.get('trustProxy', { infer: true }) ? 1 : false);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // This process serves JSON, not documents: lock the browser down hard and
      // let the Next.js app own the CSP for anything rendered.
      contentSecurityPolicy: {
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], sandbox: [] },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
      // Matches the CSP frame-ancestors directive above; helmet defaults to SAMEORIGIN.
      frameguard: { action: 'deny' },
      referrerPolicy: { policy: 'no-referrer' },
      hsts: isProduction ? { maxAge: 31_536_000, includeSubDomains: true, preload: true } : false,
    }),
  );

  app.use(compression());

  // Signed cookies: the refresh cookie is rejected unless it carries a valid
  // signature, so it cannot be forged client-side.
  app.use(cookieParser(config.get('cookie', { infer: true }).secret));

  const bodyLimit = config.get('bodyLimit', { infer: true });
  app.useBodyParser('json', { limit: bodyLimit });
  app.useBodyParser('urlencoded', { limit: bodyLimit, extended: true });

  app.enableCors({
    // Exact-match allow-list. Never reflect an arbitrary Origin back with
    // credentials enabled - that is the same as having no CORS at all.
    origin: (origin, callback) => {
      if (!origin || corsOrigins.includes(origin)) return callback(null, true);
      return callback(new Error('Origin not allowed by CORS'), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 600,
  });

  app.setGlobalPrefix(apiPrefix);
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: apiVersion });

  if (config.get('swagger', { infer: true }).enabled) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle(config.get('appName', { infer: true }))
        .setDescription('D-Trace API. Every response uses the { success, data | error } envelope.')
        .setVersion(apiVersion)
        .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token')
        .build(),
    );
    SwaggerModule.setup(`${apiPrefix}/docs`, app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  // Lets Nest run onModuleDestroy (closing the Prisma pool) on SIGTERM.
  app.enableShutdownHooks();

  // Dual-stack by default ('::' accepts IPv6 and IPv4-mapped connections).
  // Binding IPv4-only breaks callers that resolve `localhost` to ::1 first, which
  // is what Node does - the server looks up but every request is refused.
  await app.listen(port, config.get('host', { infer: true }));
}

await bootstrap();
