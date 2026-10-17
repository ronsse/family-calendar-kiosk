# family-calendar — the wall app. API, SSE, calendar sync and the React bundle, one process.
#
# Two things about this image are deliberate and easy to "fix" wrongly:
#
#   1. THE SOURCE SHIPS AS TYPESCRIPT. Node 22 strips types at load, and every import in this
#      repo already carries an explicit `.ts` extension for exactly that reason. There is no
#      compile step to skew from the source, and `src/http/sync-scheduler.ts` spawns its worker
#      from `new URL('./sync-worker.ts', import.meta.url)` — a build that emitted `.js`
#      alongside would leave that URL pointing at a file the loader resolves differently in
#      the container than on the developer's box. `tsc` still runs, as `npm run typecheck`,
#      where a type error is a build failure rather than a runtime surprise.
#
#   2. `better-sqlite3` IS A NATIVE MODULE. It is compiled in the builder stage against this
#      exact base image and copied, never rebuilt at runtime. The build toolchain therefore
#      does not exist in the final image, which is both smaller and one fewer thing that can
#      be running in the house.
#
# Pinned to the Debian-based slim image rather than Alpine: better-sqlite3 against musl means
# building from source with a different libc than every test run used, and the database file
# is the only state that matters here.

# ---------------------------------------------------------------------------------------------
FROM node:22-bookworm-slim AS builder

# node-gyp needs these; the final stage does not.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies first, as their own layer: the lockfile changes far less often than the source,
# and a native rebuild is the slow part of this image.
COPY package.json package-lock.json ./
RUN npm ci

# Everything the bundle needs to build. `web/` imports the frozen contracts from `src/`, so
# both go in.
COPY tsconfig.json ./
COPY src ./src
COPY web ./web
COPY db ./db
COPY stacks/wall/entry ./stacks/wall/entry

# Type errors fail the image rather than the wall.
RUN npx tsc --noEmit
RUN npm run build

# Drop everything that only existed to build. What is left is what the server loads.
RUN npm prune --omit=dev

# ---------------------------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

# A build-time default only; the compose file sets TZ at run time (WALL_TZ).
ARG WALL_TZ=America/Denver
ENV NODE_ENV=production \
    TZ=${WALL_TZ} \
    WALL_DB=/data/wall.db \
    WALL_ASSET_ROOT=/data/assets \
    WALL_WEB_ROOT=/app/web/dist \
    WALL_PORT=8124 \
    WALL_BIND=0.0.0.0

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/web/dist ./web/dist
COPY --from=builder /app/src ./src
COPY --from=builder /app/db ./db
COPY --from=builder /app/stacks/wall/entry ./stacks/wall/entry

# THE BASELINE ICONS. Load-bearing, and easy to read as optional static content.
#
# `seedAssets()` in entry/main.ts copies these into the /data volume on every boot, and
# `registerBaselineAssets()` then registers them — including the mandatory `_default` row that
# terminates the asset fallback chain. Without this COPY both functions return early, the
# `asset` table stays empty, and `resolveAsset` THROWS on the very first icon: a blank wall on
# day one, which is the exact failure Unit J fixed in the repo and this layer reintroduced.
# From the context rather than the builder: they are static, and nothing builds them.
COPY assets ./assets

# `node` (uid 1000) rather than root. /data is a volume; compose sets its ownership.
RUN mkdir -p /data && chown -R node:node /data /app
USER node

EXPOSE 8124

# The health probe the KIOSK believes is the same one the orchestrator does, on purpose: two
# definitions of "up" is how a container reports healthy while the wall shows a screenshot.
# `ok` and not `dbWritable` — an already-materialized day still renders from a database that
# cannot grow, and parking the family on a screenshot because the disk is 95% full would be
# strictly worse than showing them the day (see pi/config/bin/kiosk-probe.sh).
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.WALL_PORT||8124)+'/api/health').then(r=>r.json()).then(j=>process.exit(j.ok?0:1)).catch(()=>process.exit(1))"

# The flag is on argv rather than in NODE_OPTIONS so `process.execArgv` carries it into the
# calendar sync Worker, which is also TypeScript.
CMD ["node", "--experimental-strip-types", "stacks/wall/entry/main.ts"]
