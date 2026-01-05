#!/bin/bash
# ZK Guardian Circuit Compilation Script
# Usage: ./scripts/compile.sh

# Set up environment for Rust/Circom
if [ -f "$HOME/.cargo/env" ]; then
    source "$HOME/.cargo/env"
fi

set -e

CIRCUIT_NAME="AccessIsAllowed"
BUILD_DIR="build"

echo "🔧 Compiling ZK Guardian circuits..."

# Create build directory
mkdir -p $BUILD_DIR

# Compile circuit
echo "📐 Compiling $CIRCUIT_NAME.circom..."
circom ${CIRCUIT_NAME}.circom \
  --r1cs \
  --wasm \
  --sym \
  --output $BUILD_DIR \
  -l node_modules

echo "✅ Circuit compiled successfully!"
echo "   R1CS: $BUILD_DIR/${CIRCUIT_NAME}.r1cs"
echo "   WASM: $BUILD_DIR/${CIRCUIT_NAME}_js/${CIRCUIT_NAME}.wasm"

# Show constraint count
echo ""
echo "📊 Constraint info:"
snarkjs r1cs info $BUILD_DIR/${CIRCUIT_NAME}.r1cs
