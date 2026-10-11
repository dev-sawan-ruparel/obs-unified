# Multi-stage build for ghcr.io/dev-sawan-ruparel/obs-unified
# All-in-one container: Node.js collector + React dashboard SPA + embedded PostgreSQL & file blob store

FROM node:22-bookworm-slim AS build
WORKDIR /repo
ENV CI=true
RUN corepack enable && corepack prepare pnpm@10 --activate
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @obs-demo/collector-node... --filter @obs-demo/web... run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /repo
ENV NODE_ENV=production
ENV PORT=8790
ENV OBS_DASHBOARD_PORT=5173
ENV OBS_LOCAL_SEED=false
ENV REQUIRE_AUTH_CONFIG=true

RUN apt-get update \
	&& apt-get install -y --no-install-recommends postgresql curl ca-certificates \
	&& rm -rf /var/lib/apt/lists/*

COPY --from=build /repo /repo
RUN chmod +x /repo/docker/local/start.sh

VOLUME ["/data", "/var/lib/postgresql"]
EXPOSE 5173 8790

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
	CMD curl -fsS http://127.0.0.1:8790/health >/dev/null && curl -fsS http://127.0.0.1:5173/ >/dev/null || exit 1

CMD ["/repo/docker/local/start.sh"]
