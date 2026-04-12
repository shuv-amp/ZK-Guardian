FROM node:20-alpine AS builder

WORKDIR /workspace

# Install pnpm and workspace dependencies
RUN npm install -g pnpm
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY gateway/package.json gateway/package.json
COPY contracts/package.json contracts/package.json
COPY circuits/package.json circuits/package.json
RUN pnpm install --filter gateway --filter contracts --filter circuits --no-frozen-lockfile

# Copy workspace sources and canonical artifacts
COPY gateway ./gateway
COPY contracts ./contracts
COPY circuits ./circuits
COPY checksums.sha256 ./checksums.sha256

# Gateway relies on compiled contract ABIs and packaged circuit artifacts.
RUN pnpm --filter contracts compile
RUN pnpm --filter gateway build

# Production stage
FROM node:20-alpine

WORKDIR /workspace

# Keep the built workspace layout intact so relative ABI/artifact paths resolve.
COPY --from=builder /workspace /workspace

# Set environment
ENV NODE_ENV=production
ENV PORT=3000
ENV CIRCUIT_ARTIFACTS_DIR=/workspace/circuits/build

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

# Start gateway
WORKDIR /workspace/gateway
CMD ["node", "dist/index.js"]
