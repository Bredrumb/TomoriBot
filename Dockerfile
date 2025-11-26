# Use the official Bun image as base
# Think of this as choosing the "apartment building type" - Bun comes pre-installed
FROM oven/bun:1.2.12-alpine AS base

# Set the working directory inside the container
# This is like choosing which floor/apartment number TomoriBot lives in
WORKDIR /app

# Install system dependencies that might be needed
# Alpine Linux is minimal, so we add some common tools
# Include Python/pip and Node.js/npm for MCP server support
# Pin Python 3.12 for consistency with pre-downloaded wheels
RUN apk add --no-cache \
    ca-certificates \
    tzdata \
    python3~=3.12 \
    py3-pip \
    nodejs \
    npm && \
    ln -sf /usr/bin/python3 /usr/bin/python && \
    npm install -g @mozilla/readability jsdom turndown

# Copy pre-downloaded npm packages (downloaded by GitHub Actions runner)
# This avoids network issues during Docker build in CI/CD
# For local builds, this directory may be empty (packages will be downloaded from npm)
COPY docker-npm-cache/ /tmp/npm-packages/

# Pre-install npm-based MCP servers globally as root (before switching to non-root user)
# This prevents on-the-fly downloads during container startup which can timeout
RUN if [ "$(ls -A /tmp/npm-packages 2>/dev/null)" ]; then \
        echo "Installing npm MCP servers from pre-downloaded packages..." && \
        npm install -g /tmp/npm-packages/*.tgz && \
        echo "npm MCP servers installed from cache"; \
    else \
        echo "No pre-downloaded packages found, downloading from npm..." && \
        npm install -g @oevortex/ddg_search@latest && \
        echo "DuckDuckGo MCP server installed from npm"; \
    fi && \
    rm -rf /tmp/npm-packages

# Create a non-root user for security
# It's like giving TomoriBot her own user account instead of admin access
RUN addgroup -g 1001 -S tomori && \
    adduser -S tomori -u 1001 -G tomori

# Change ownership of the app directory to our user
RUN chown -R tomori:tomori /app

# Switch to non-root user
USER tomori

# Add user's local bin directory to PATH for pip installed scripts
# Add NODE_PATH so mcp-server-fetch can find globally installed npm packages
ENV PATH="/home/tomori/.local/bin:$PATH"
ENV NODE_PATH="/usr/lib/node_modules"

# Copy pre-downloaded Python packages (downloaded by GitHub Actions runner)
# This avoids network issues during Docker build in CI/CD
# For local builds, this directory may be empty (packages will be downloaded from PyPI)
COPY --chown=tomori:tomori docker-pip-cache/ /tmp/pip-packages/

# Install Python-based MCP servers as tomori user
# Use --break-system-packages for Alpine Linux PEP 668 compliance
RUN if [ "$(ls -A /tmp/pip-packages 2>/dev/null)" ]; then \
        echo "Installing Python MCP servers from pre-downloaded packages..." && \
        pip3 install --user --break-system-packages --no-index --find-links=/tmp/pip-packages mcp-server-fetch; \
    else \
        echo "No pre-downloaded packages found, downloading from PyPI..." && \
        pip3 install --user --break-system-packages mcp-server-fetch==2025.4.7; \
    fi && \
    rm -rf /tmp/pip-packages

# Pre-cache npm-based MCP servers by running npx once as tomori user
# This downloads and caches the package in ~/.npm/_npx, preventing timeout during bot startup
RUN echo "Pre-caching npm MCP servers for tomori user..." && \
    timeout 60 npx -y @oevortex/ddg_search@latest --help > /dev/null 2>&1 || true && \
    echo "DuckDuckGo MCP server cached successfully"

# Copy package files first for better Docker layer caching
# This is like getting the "lease agreement" (dependencies) ready first
COPY --chown=tomori:tomori package.json ./
COPY --chown=tomori:tomori tsconfig.json ./
# Copy lockfile if it exists (Bun sometimes uses different names)
COPY --chown=tomori:tomori bun.lock* ./

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

# Copy SSL certificates for secure database connections
# AWS RDS CA bundle for verify-full SSL mode (protects against MITM attacks)
COPY --chown=tomori:tomori docker/certs/ ./certs/

# No build step needed - Bun runs TypeScript natively!
# This matches your proven development setup

# Environment variables that should be consistent
ENV NODE_ENV=production
ENV RUN_ENV=production

# Health check to ensure TomoriBot is running properly
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD ps aux | grep -v grep | grep "bun.*src/index.ts" || exit 1

# Run TypeScript directly - just like your development setup
CMD ["bun", "run", "src/index.ts"]
