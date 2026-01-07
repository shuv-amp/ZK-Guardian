#!/bin/bash
#
# ZK Guardian - Download Powers of Tau
# Downloads the Hermez ptau file for ZK trusted setup
#
# Usage: ./scripts/download-ptau.sh [power]
# Default power is 14 (sufficient for our circuits)
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CIRCUITS_DIR="$(cd "$SCRIPT_DIR/../circuits" && pwd)"

# Powers of Tau power level (2^14 = 16384 constraints max)
# Increase if circuits grow larger
POWER=${1:-14}

# File URL from Hermez ceremony
PTAU_URL="https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_${POWER}.ptau"
PTAU_FILE="$CIRCUITS_DIR/powersOfTau28_hez_final_${POWER}.ptau"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

# Download PTAU file
download_ptau() {
    if [ -f "$PTAU_FILE" ]; then
        log_info "PTAU file already exists: $PTAU_FILE"
        return 0
    fi
    
    log_info "Downloading Powers of Tau (power=${POWER})..."
    log_info "This may take a few minutes depending on your connection..."
    
    # Use curl or wget
    if command -v curl &> /dev/null; then
        curl -L -o "$PTAU_FILE" "$PTAU_URL" --progress-bar
    elif command -v wget &> /dev/null; then
        wget -O "$PTAU_FILE" "$PTAU_URL" --show-progress
    else
        log_warn "Neither curl nor wget found. Please install one."
        exit 1
    fi
    
    log_info "Download complete: $PTAU_FILE"
}

# Verify file
verify_ptau() {
    log_info "Verifying PTAU file..."
    
    local file_size=$(stat -f%z "$PTAU_FILE" 2>/dev/null || stat -c%s "$PTAU_FILE" 2>/dev/null)
    
    if [ -z "$file_size" ] || [ "$file_size" -lt 1000000 ]; then
        log_warn "PTAU file appears corrupt or incomplete. Removing..."
        rm -f "$PTAU_FILE"
        exit 1
    fi
    
    log_info "PTAU file verified (size: $file_size bytes)"
}

main() {
    mkdir -p "$CIRCUITS_DIR"
    download_ptau
    verify_ptau
    log_info "Powers of Tau ready for trusted setup"
}

main "$@"
