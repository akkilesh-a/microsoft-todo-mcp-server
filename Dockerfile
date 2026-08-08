# syntax=docker/dockerfile:1

# bookworm-slim rather than alpine: better-sqlite3 is a native addon, and the musl/glibc
# split means alpine either has no prebuilt binary to download or needs a full toolchain to
# compile one. Debian slim gets the prebuild on both amd64 and arm64.
ARG NODE_VERSION=22-bookworm-slim

# ─── build ───────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS build
WORKDIR /app

# python3/make/g++ are the node-gyp toolchain. better-sqlite3 normally downloads a prebuilt
# binary and never touches them, but they are needed on any platform without one — without
# them that case fails at install time instead of falling back to a compile.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsup.config.ts ./
COPY src ./src
RUN npm run build

# ─── production dependencies ─────────────────────────────────────────────────
# A separate stage so the runtime image gets node_modules without dev dependencies and
# without the C++ toolchain, while the native addon is still built against the same glibc.
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ─── runtime ─────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production

WORKDIR /app

COPY --from=deps  /app/node_modules ./node_modules
COPY --from=build /app/dist         ./dist
# The migration runner reads these at runtime — they are not compiled into the bundle.
COPY migrations ./migrations
COPY package.json ./

# Default both pieces of state into one directory so a single volume covers everything that
# must survive a container recreate. With DATABASE_URL set, lists.db goes unused and only
# tokens.json lives here.
ENV MSTODO_TOKEN_FILE=/data/tokens.json \
    LIST_DB_PATH=/data/lists.db \
    PORT=3001

RUN mkdir -p /data && chown -R node:node /data
VOLUME ["/data"]

USER node
EXPOSE 3001

# Hits the one route that is public by design — /health is exempt from the API key check,
# so this works whether or not MCP_API_KEY is set.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Migrations run inside the server on boot (AUTO_MIGRATE), so there is no entrypoint script.
CMD ["node", "dist/todo-index.js"]
