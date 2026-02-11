FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY gateway/package*.json ./
COPY gateway/pnpm-lock.yaml* ./

# Install pnpm and dependencies
RUN npm install -g pnpm
RUN pnpm install --no-frozen-lockfile

# Copy source
COPY gateway .

# Copy circuit artifacts for proof generation
COPY circuits/build /app/circuits/build
COPY checksums.sha256 /app/circuits/checksums.sha256

# Copy contract artifacts for relative import resolution (../../../contracts/artifacts)
COPY contracts/artifacts /contracts/artifacts

# Build TypeScript
RUN pnpm exec prisma generate --schema prisma/schema.prisma && (pnpm exec tsc --noEmitOnError false || true)

# Production stage
FROM node:20-alpine

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy built files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/pnpm-lock.yaml* ./
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/circuits/build ./circuits/build
COPY --from=builder /app/circuits/checksums.sha256 ./circuits/checksums.sha256

# Install production dependencies only
RUN pnpm install --prod --no-frozen-lockfile
RUN pnpm exec prisma generate --schema prisma/schema.prisma

# Set environment
ENV NODE_ENV=production
ENV PORT=3000

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

# Start gateway
CMD ["node", "dist/index.js"]
