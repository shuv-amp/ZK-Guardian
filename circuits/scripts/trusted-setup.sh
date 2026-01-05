#!/bin/bash
# ZK Guardian Trusted Setup Script
# Usage: ./scripts/trusted-setup.sh

set -e

CIRCUIT_NAME="AccessIsAllowed"
PTAU_SIZE=14
BUILD_DIR="build"
PTAU_FILE="powersOfTau28_hez_final_14.ptau"
PTAU_URL="https://hermez.s3-eu-west-1.amazonaws.com/$PTAU_FILE"

echo "🔐 Starting ZK Guardian Trusted Setup..."

# Generate locally (reliable for dev)
if [ ! -f "$BUILD_DIR/$PTAU_FILE" ]; then
  echo "⚡ Generating local Powers of Tau (Series 14)..."
  snarkjs powersoftau new bn128 ${PTAU_SIZE} $BUILD_DIR/pot${PTAU_SIZE}_0000.ptau -v
  snarkjs powersoftau contribute $BUILD_DIR/pot${PTAU_SIZE}_0000.ptau $BUILD_DIR/pot${PTAU_SIZE}_0001.ptau --name="First" -v -e="randomness"
  snarkjs powersoftau prepare phase2 $BUILD_DIR/pot${PTAU_SIZE}_0001.ptau $BUILD_DIR/$PTAU_FILE -v
  rm -f $BUILD_DIR/pot${PTAU_SIZE}_0000.ptau $BUILD_DIR/pot${PTAU_SIZE}_0001.ptau
else
  echo "✅ Powers of Tau already present"
fi

# Phase 2: Circuit-specific setup
echo "🔧 Starting Phase 2 setup..."

# Generate initial zkey
snarkjs groth16 setup \
  $BUILD_DIR/${CIRCUIT_NAME}.r1cs \
  $BUILD_DIR/$PTAU_FILE \
  $BUILD_DIR/${CIRCUIT_NAME}_0000.zkey

# Contribute entropy (production: use multiple parties)
echo "🎲 Contributing randomness..."
snarkjs zkey contribute \
  $BUILD_DIR/${CIRCUIT_NAME}_0000.zkey \
  $BUILD_DIR/${CIRCUIT_NAME}_final.zkey \
  --name="ZK Guardian Phase 2" \
  -v -e="$(head -c 64 /dev/urandom | xxd -p)"

# Export verification key
echo "📤 Exporting verification key..."
snarkjs zkey export verificationkey \
  $BUILD_DIR/${CIRCUIT_NAME}_final.zkey \
  $BUILD_DIR/verification_key.json

# Export Solidity verifier
echo "📝 Generating Solidity verifier..."
snarkjs zkey export solidityverifier \
  $BUILD_DIR/${CIRCUIT_NAME}_final.zkey \
  ../contracts/src/Groth16Verifier.sol

# Cleanup intermediate files
rm -f $BUILD_DIR/${CIRCUIT_NAME}_0000.zkey

echo ""
echo "✅ Trusted setup complete!"
echo "   Final zkey: $BUILD_DIR/${CIRCUIT_NAME}_final.zkey"
echo "   Verification key: $BUILD_DIR/verification_key.json"
echo "   Solidity verifier: ../contracts/src/Groth16Verifier.sol"
