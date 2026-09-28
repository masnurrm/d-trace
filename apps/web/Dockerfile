# Build context MUST be the repo root — same reason as apps/api/Dockerfile.
#   docker build -f apps/web/Dockerfile -t dtrace-web .

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
COPY apps/web apps/web
RUN npm run build --workspace @dtrace/shared
# Build-time env: only used to satisfy zod validation in lib/config/env.ts
# and to bake NEXT_PUBLIC_* values (there are none here — the API URL is a
# runtime server-only value, read fresh from the container's real env.ts at
# request time, not baked into the client bundle).
RUN API_URL=http://api:4000 npm run build --workspace @dtrace/web

# ---------------------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S dtrace && adduser -S dtrace -G dtrace

# `output: 'standalone'` (next.config.ts) traces the minimal node_modules
# this actually needs — a fraction of the full workspace install. Static
# assets and public/ are excluded from that trace on purpose and must be
# copied in separately.
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public

RUN chown -R dtrace:dtrace /app
USER dtrace

EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/web/server.js"]
