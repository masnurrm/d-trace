# Build context MUST be the repo root (npm workspaces monorepo — @dtrace/api
# depends on @dtrace/shared, and `npm ci` needs every workspace's
# package.json up front to resolve the tree):
#   docker build -f apps/api/Dockerfile -t dtrace-api .
# deploy/docker/docker-compose.yml sets this context automatically.

FROM node:22-alpine AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci

FROM deps AS build
WORKDIR /repo
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build --workspace @dtrace/shared
# prisma generate (prebuild) needs DATABASE_URL to *parse*, not to connect —
# any well-formed value satisfies prisma.config.ts at build time.
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    npm run build --workspace @dtrace/api

# ---------------------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S dtrace && adduser -S dtrace -G dtrace

# nest build's tsc compiles everything under src/ (the Prisma client included
# — it's generated as .ts, per prisma.config.ts's `output` path), so dist/ is
# self-contained. Only node_modules (npm workspace dependencies + Prisma's
# runtime/engine packages) and package.json need to come along separately.
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages/shared/dist ./node_modules/@dtrace/shared/dist
COPY --from=build /repo/packages/shared/package.json ./node_modules/@dtrace/shared/package.json
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/prisma ./prisma
COPY --from=build /repo/apps/api/prisma.config.ts ./prisma.config.ts
COPY --from=build /repo/apps/api/package.json ./package.json

RUN mkdir -p /app/storage/uploads && chown -R dtrace:dtrace /app
USER dtrace

EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/v1/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
