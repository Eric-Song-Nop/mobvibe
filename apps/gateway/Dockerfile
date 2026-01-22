FROM node:20-alpine AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy workspace root files
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./

# Copy all workspace packages needed by gateway
COPY packages/shared ./packages/shared
COPY packages/convex ./packages/convex
COPY apps/gateway ./apps/gateway

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build all packages in order
RUN pnpm --filter @remote-claude/shared build
RUN pnpm --filter @remote-claude/convex build
RUN pnpm --filter gateway build

# Production image
FROM node:20-alpine

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy built artifacts and package files
COPY --from=builder /app/pnpm-lock.yaml /app/pnpm-workspace.yaml /app/package.json ./
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/packages/convex ./packages/convex
COPY --from=builder /app/apps/gateway ./apps/gateway

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

WORKDIR /app/apps/gateway

EXPOSE 3005

CMD ["node", "dist/index.js"]
