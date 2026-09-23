# syntax=docker/dockerfile:1
#
# bwvault — Web UI + CLI for Bitwarden Vault Manager.
#
# Modes:
#   1. Web UI (default): serve the dashboard on port 3000
#      docker run -d -p 3000:3000 -v bwvault-data:/data bwvault
#
#   2. CLI: override entrypoint to run CLI commands
#      docker run --rm -v bwvault-data:/data bwvault cli vault list --json
#
# Build:
#   docker buildx build --platform linux/amd64 --load -t bwvault:amd64 .

# ---------- Stage 1: install deps ----------
FROM node:22-slim AS deps
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# ---------- Stage 2: build web app ----------
FROM node:22-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY vite.config.js index.html ./
COPY src ./src
COPY public ./public
COPY functions ./functions
RUN npm install && npx vite build

# ---------- Stage 3: runtime ----------
FROM node:22-slim AS runtime

RUN apt-get update \
 && apt-get install -y --no-install-recommends tini ca-certificates openssl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Runtime deps only
COPY --from=deps /build/node_modules ./node_modules
# Built web assets
COPY --from=builder /app/dist ./dist
# Server + CLI
COPY server.js ./server.js
COPY package.json ./
COPY agent-harness ./agent-harness
# Source needed for CLI (crypto engine lives in src/)
COPY src ./src

ENV BWVAULT_HOME=/data/session \
    NODE_ENV=production \
    PORT=3000 \
    NO_COLOR=

RUN mkdir -p /data/session && chown -R node:node /data /app

COPY start.sh ./start.sh
RUN chmod 0755 /app/start.sh
USER node
VOLUME ["/data"]
EXPOSE 3000 3443

# Default: run Web UI. Use "cli" as first arg for CLI commands.
ENTRYPOINT ["/usr/bin/tini", "--", "/bin/bash", "/app/start.sh"]
CMD ["web"]

HEALTHCHECK --interval=60s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://localhost:3000').then(r=>{process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"]
