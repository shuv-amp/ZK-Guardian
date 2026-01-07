FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY gateway/package*.json ./
COPY gateway/pnpm-lock.yaml* ./

# Install pnpm and dependencies
# Install dependencies using npm (more robust for Prisma in Docker)
RUN npm install

# Copy source
COPY gateway .

# Copy contract artifacts for relative import resolution (../../../contracts/artifacts)
COPY contracts/artifacts /contracts/artifacts

# Build TypeScript
RUN npx prisma generate && npx tsc

# Production stage
FROM node:20-alpine

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy built files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/pnpm-lock.yaml* ./

# Install production dependencies only
RUN npm install --omit=dev

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
