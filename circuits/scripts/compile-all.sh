#!/bin/bash
# ZK Guardian - Compile All Circuits
set -e

# Circuits to compile
CIRCUITS=("AccessIsAllowedSecure" "BreakGlass")
BUILD_DIR="build"

echo "🔧 Compiling ZK Guardian Circuits..."
mkdir -p $BUILD_DIR

for CIRCUIT in "${CIRCUITS[@]}"; do
    echo ""
    echo "📐 Compiling $CIRCUIT.circom..."
    circom "${CIRCUIT}.circom" \
        --r1cs --wasm --sym \
        --output $BUILD_DIR \
        -l node_modules \
        -l ../node_modules/circomlib/circuits

    echo "✅ $CIRCUIT compiled"
    
    # Check constraints
    echo "📊 Constraint info:"
    snarkjs r1cs info "$BUILD_DIR/$CIRCUIT.r1cs"
done

echo ""
echo "🎉 All circuits compiled successfully!"
