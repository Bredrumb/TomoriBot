# Use the official Bun image as base
# Think of this as choosing the "apartment building type" - Bun comes pre-installed
FROM oven/bun:1.3.3-alpine AS base

# Set the working directory inside the container
# This is like choosing which floor/apartment number TomoriBot lives in
WORKDIR /app

# Install system dependencies that might be needed
# Alpine Linux is minimal, so we add some common tools
# Include Python/pip and Node.js/npm for MCP server support
# Pin Python 3.12 for consistency with pre-downloaded wheels
# Include curl for health checks
# --- SECURITY FIX: Added 'apk update && apk upgrade' to patch OpenSSL CVEs ---
RUN apk update && apk upgrade && \
    apk add --no-cache \
    ca-certificates \
    tzdata \
    curl \
    ffmpeg \
    python3~=3.12 \
    py3-pip \
    nodejs \
    npm && \
    ln -sf /usr/bin/python3 /usr/bin/python

# Note: DuckDuckGo MCP server is run via bunx (see pre-cache step below as tomori user)
# No global npm install needed - bunx handles package resolution at runtime

# Create a non-root user for security
# It's like giving TomoriBot her own user account instead of admin access
RUN addgroup -g 1001 -S tomori && \
    adduser -S tomori -u 1001 -G tomori

# Change ownership of the app directory to our user
RUN chown -R tomori:tomori /app

# Switch to non-root user
USER tomori

# Add project/user bin directories to PATH for installed MCP server scripts
# Add NODE_PATH so mcp-server-fetch can find globally installed npm packages
ENV PATH="/app/node_modules/.bin:/home/tomori/.local/bin:$PATH"
ENV NODE_PATH="/app/node_modules"

# Copy pre-downloaded Python packages (downloaded by GitHub Actions runner)
# This avoids network issues during Docker build in CI/CD
# For local builds, this directory may be empty (packages will be downloaded from PyPI)
COPY --chown=tomori:tomori docker/pip-cache/ /tmp/pip-packages/

# Install Python-based MCP servers as tomori user
# Use --break-system-packages for Alpine Linux PEP 668 compliance
RUN if [ "$(ls /tmp/pip-packages/*.whl 2>/dev/null)" ]; then \
        echo "Installing Python MCP servers from pre-downloaded packages..." && \
        pip3 install --user --break-system-packages --no-index --find-links=/tmp/pip-packages mcp-server-fetch; \
    else \
        echo "Missing pre-downloaded Python packages; refusing live PyPI install in production image." >&2 && \
        exit 1; \
    fi && \
    rm -rf /tmp/pip-packages

# Fix readabilipy's ESM issues with Node 20 by using the project's native dependencies
RUN echo "Linking readabilipy to root dependencies..." && \
    READABILIPY_DIR=$(python3 -c "import readabilipy, os; print(os.path.dirname(readabilipy.__file__))") && \
    rm -rf "$READABILIPY_DIR/javascript/node_modules" "$READABILIPY_DIR/javascript/package-lock.json" && \
    ln -s /app/node_modules "$READABILIPY_DIR/javascript/node_modules"

# Copy package files first for better Docker layer caching
# This is like getting the "lease agreement" (dependencies) ready first
COPY --chown=tomori:tomori package.json ./
COPY --chown=tomori:tomori tsconfig.json ./
# Copy lockfile if it exists (Bun sometimes uses different names)
COPY --chown=tomori:tomori bun.lock* ./
# Copy patches directory for patchedDependencies (e.g. matrix-sdk-crypto-nodejs)
COPY --chown=tomori:tomori patches/ ./patches/

# Install dependencies
# Think of this as "furnishing the apartment" with all the tools TomoriBot needs
RUN bun install --frozen-lockfile --production

# Copy the rest of the application code
# This is like moving TomoriBot's belongings into her new apartment
COPY --chown=tomori:tomori src/ ./src/

# Copy static images used by slash commands (banners)
COPY --chown=tomori:tomori img/ ./img/

# Copy legal documents (Terms of Service, Privacy Policy)
COPY --chown=tomori:tomori legal/ ./legal/

# Copy local tokenizer assets used by model-aware logit-bias resolution
COPY --chown=tomori:tomori tokenizers/ ./tokenizers/

# Copy SSL certificates for secure database connections
# AWS RDS CA bundle for verify-full SSL mode (protects against MITM attacks)
COPY --chown=tomori:tomori docker/certs/ ./certs/

# No build step needed - Bun runs TypeScript natively!
# This matches your proven development setup

# Environment variables that should be consistent
ENV NODE_ENV=production
ENV RUN_ENV=production
ENV TOKENIZER_ASSET_DIR=./tokenizers

# Cloud Run injects PORT=8080; the health server binds to 0.0.0.0:$PORT
EXPOSE 8080

# Health check for local docker run — Cloud Run uses its own TCP startup probe on PORT
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://0.0.0.0:${PORT:-8080}/health || exit 1

# Run TypeScript directly - just like your development setup
CMD ["bun", "run", "src/index.ts"]
