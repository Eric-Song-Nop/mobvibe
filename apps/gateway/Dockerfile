FROM node:22-alpine AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy workspace root files
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY scripts/ ./scripts/

# Copy all workspace packages needed by gateway
COPY packages/shared ./packages/shared
COPY apps/gateway ./apps/gateway

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build all packages in order
RUN pnpm --filter @mobvibe/shared build
RUN pnpm --filter gateway build

# Production image
FROM node:22-alpine

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy built artifacts and package files
COPY --from=builder /app/pnpm-lock.yaml /app/pnpm-workspace.yaml /app/package.json ./
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/apps/gateway ./apps/gateway

# Install all dependencies (need drizzle-kit for migrations)
RUN pnpm install --frozen-lockfile

WORKDIR /app/apps/gateway

# Create startup script for migrations + server
# DATABASE_URL is required - app will fail without it
RUN echo '#!/bin/sh' > /app/start.sh && \
    echo 'set -e' >> /app/start.sh && \
    echo 'echo "[gateway] Running database migrations..."' >> /app/start.sh && \
    echo 'npx drizzle-kit migrate' >> /app/start.sh && \
    echo 'echo "[gateway] Migrations complete"' >> /app/start.sh && \
    echo 'exec node dist/index.js' >> /app/start.sh && \
    chmod +x /app/start.sh

EXPOSE 3005

CMD ["/app/start.sh"]
