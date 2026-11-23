FROM oven/bun:1.4.0-alpine@sha256:07235578f79ef8c6f97d94aee7938e76f5cdba5f21ae5dbfdd3d3d38058437eb AS base

WORKDIR /app

# Upgrade Alpine packages so OpenSSL security patches apply; curl is required by the health check below.
RUN apk update && apk upgrade && \
    apk add --no-cache \
    ca-certificates \
    tzdata \
    curl \
    ffmpeg \
    postgresql-client

RUN addgroup -g 1001 -S tomori && \
    adduser -S tomori -u 1001 -G tomori

RUN mkdir -p /app/backups /app/logs /app/data && \
    chown -R tomori:tomori /app

USER tomori

# Manifests and patches copy before src/ so dependency installs stay cached across code edits.
COPY --chown=tomori:tomori package.json ./
COPY --chown=tomori:tomori tsconfig.json ./
COPY --chown=tomori:tomori bun.lock* ./
COPY --chown=tomori:tomori patches/ ./patches/
# Workspace manifests are required for --frozen-lockfile resolution; their dev-only deps are
# pruned by --production below.
COPY --chown=tomori:tomori apps/docs/package.json ./apps/docs/package.json

RUN bun install --frozen-lockfile --production

COPY --chown=tomori:tomori src/ ./src/

# Shipped so Docker Compose users can run backup and restore inside the container without host Bun.
COPY --chown=tomori:tomori scripts/ ./scripts/

COPY --chown=tomori:tomori assets/img/ ./assets/img/

# Alpine ships no system fonts, so satori and resvg load bundled buffers from here
# (see assets/fonts/README.md).
COPY --chown=tomori:tomori assets/fonts/ ./assets/fonts/

COPY --chown=tomori:tomori tokenizers/ ./tokenizers/

# AWS RDS requires its dedicated CA bundle here (Azure PostgreSQL uses the OS trust store).
COPY --chown=tomori:tomori docker/certs/ ./certs/

ENV NODE_ENV=production
ENV RUN_ENV=production
ENV TOKENIZER_ASSET_DIR=./tokenizers

# Cloud Run injects PORT=8080: the health server binds to 0.0.0.0:$PORT.
EXPOSE 8080

# Used by local docker run: Cloud Run uses its own TCP startup probe on PORT.
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://0.0.0.0:${PORT:-8080}/health || exit 1

CMD ["bun", "run", "src/index.ts"]
