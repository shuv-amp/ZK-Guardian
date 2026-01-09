#!/bin/bash
# scripts/setup-production.sh
#
# Complete production setup for ZK Guardian
# Run this script after cloning the repository

set -e

echo "╔══════════════════════════════════════════════════════════╗"
echo "║           ZK Guardian - Production Setup                 ║"
echo "╚══════════════════════════════════════════════════════════╝"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

step() {
    echo -e "${GREEN}[STEP]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
    exit 1
}

# Check prerequisites
step "Checking prerequisites..."
command -v node >/dev/null 2>&1 || error "Node.js is required"
command -v pnpm >/dev/null 2>&1 || error "pnpm is required (npm install -g pnpm)"
command -v docker >/dev/null 2>&1 || warn "Docker not found - observability stack unavailable"

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    error "Node.js 18+ required (found: $(node -v))"
fi

echo "  ✓ Node.js $(node -v)"
echo "  ✓ pnpm $(pnpm -v)"

# Install dependencies
step "Installing dependencies..."
pnpm install

# Install OpenTelemetry (optional but recommended)
step "Installing OpenTelemetry packages..."
cd gateway
pnpm add @opentelemetry/sdk-node \
         @opentelemetry/auto-instrumentations-node \
         @opentelemetry/exporter-trace-otlp-http \
         @opentelemetry/api \
         @opentelemetry/resources \
         @opentelemetry/semantic-conventions \
         @opentelemetry/core \
         @opentelemetry/sdk-trace-base 2>/dev/null || warn "OpenTelemetry packages not installed"
cd ..

# Generate Prisma client
step "Generating Prisma client..."
cd gateway
pnpm prisma generate
cd ..

# Build circuits (if not already built)
step "Checking circuit files..."
if [ ! -f "circuits/build/AccessIsAllowedSecure/AccessIsAllowedSecure_final.zkey" ]; then
    warn "Circuits not built. Run 'pnpm --filter circuits build' to compile"
else
    echo "  ✓ Circuits found"
    # Generate checksums
    echo "  Generating circuit checksums..."
    sha256sum circuits/build/AccessIsAllowedSecure/AccessIsAllowedSecure_final.zkey > circuits/checksums.sha256
    sha256sum circuits/build/AccessIsAllowedSecure/AccessIsAllowedSecure_js/AccessIsAllowedSecure.wasm >> circuits/checksums.sha256
    echo "  ✓ Checksums saved to circuits/checksums.sha256"
fi

# Create .env from example if not exists
step "Checking environment configuration..."
if [ ! -f "gateway/.env" ]; then
    cp gateway/.env.example gateway/.env
    warn "Created gateway/.env from example - please configure!"
else
    echo "  ✓ gateway/.env exists"
fi

# Create keys directory
step "Setting up key management..."
mkdir -p gateway/.keys
chmod 700 gateway/.keys
echo "  ✓ Created secure keys directory"

# Docker observability stack
step "Docker observability stack..."
if command -v docker >/dev/null 2>&1; then
    echo "  To start: docker-compose -f docker-compose.observability.yml up -d"
    echo "  Services:"
    echo "    - Grafana:     http://localhost:3001 (admin/zkguardian)"
    echo "    - Prometheus:  http://localhost:9090"
    echo "    - Jaeger:      http://localhost:16686"
else
    warn "Docker not available - skip observability stack"
fi

# Run migrations (if database URL configured)
step "Database setup..."
if grep -q "DATABASE_URL" gateway/.env 2>/dev/null; then
    cd gateway
    pnpm prisma migrate deploy 2>/dev/null || warn "Database migration failed - check DATABASE_URL"
    cd ..
else
    warn "DATABASE_URL not configured in gateway/.env"
fi

# Final instructions
echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║           Setup Complete!                                ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║                                                          ║"
echo "║  Next Steps:                                             ║"
echo "║                                                          ║"
echo "║  1. Configure gateway/.env:                              ║"
echo "║     - DATABASE_URL (PostgreSQL connection)               ║"
echo "║     - KEY_MASTER_PASSWORD (for key management)           ║"
echo "║     - POLYGON_AMOY_RPC (for blockchain audit)            ║"
echo "║                                                          ║"
echo "║  2. Start services:                                      ║"
echo "║     docker-compose -f docker-compose.observability.yml up -d  ║"
echo "║     pnpm --filter gateway dev                            ║"
echo "║                                                          ║"
echo "║  3. Run tests:                                           ║"
echo "║     pnpm --filter gateway test                           ║"
echo "║                                                          ║"
echo "╚══════════════════════════════════════════════════════════╝"
