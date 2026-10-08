# Standalone Node.js collector — Postgres + S3 backend.
# Multi-stage build keeps the runtime image small (~150 MB compressed).

FROM node:22-alpine AS deps
WORKDIR /repo
ENV CI=true
RUN corepack enable && corepack prepare pnpm@10 --activate
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/collector-node/package.json apps/collector-node/
COPY packages/obs-collector/package.json packages/obs-collector/
COPY packages/obs-types/package.json packages/obs-types/
COPY packages/pprof-decoder/package.json packages/pprof-decoder/
COPY packages/telemetry-sdk/package.json packages/telemetry-sdk/
RUN pnpm fetch

FROM node:22-alpine AS build
WORKDIR /repo
ENV CI=true
RUN corepack enable && corepack prepare pnpm@10 --activate
COPY --from=deps /repo .
COPY . .
RUN pnpm install --frozen-lockfile --offline
RUN pnpm -r --filter "./packages/*" run build
RUN pnpm --filter @obs-demo/collector-node run build

FROM node:22-alpine AS runtime
WORKDIR /repo/apps/collector-node
ENV NODE_ENV=production
ENV PORT=8790
RUN apk add --no-cache tini
COPY --from=build /repo /repo
EXPOSE 8790
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
	CMD wget -q -O- http://127.0.0.1:8790/health || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
