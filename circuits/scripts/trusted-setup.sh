#!/bin/bash
# ZK Guardian - Trusted Setup Script
# Generates proving and verification keys for the AccessIsAllowed circuit

set -e

echo "🔐 ZK Guardian Trusted Setup"
echo "============================"

# Configuration
CIRCUIT_NAME="AccessIsAllowed"
PTAU_FILE="powersOfTau28_hez_final_14.ptau"
PTAU_URL="https://hermez.s3-eu-west-1.amazonaws.com/${PTAU_FILE}"
BUILD_DIR="build"

# Create build directory
mkdir -p "${BUILD_DIR}"
cd "$(dirname "$0")/.."

# Step 1: Download Powers of Tau (Hermez ceremony)
echo ""
echo "📥 Step 1: Downloading Powers of Tau..."
if [ ! -f "${BUILD_DIR}/${PTAU_FILE}" ]; then
    curl -L "${PTAU_URL}" -o "${BUILD_DIR}/${PTAU_FILE}"
    echo "✅ Downloaded ${PTAU_FILE}"
else
    echo "✅ ${PTAU_FILE} already exists"
fi

# Step 2: Compile circuit
echo ""
echo "⚙️ Step 2: Compiling circuit..."
circom "${CIRCUIT_NAME}.circom" \
    --r1cs --wasm --sym \
    -o "${BUILD_DIR}" \
    -l node_modules/circomlib/circuits

echo "✅ Circuit compiled"

# Step 3: Generate zkey (Phase 2)
echo ""
echo "🔑 Step 3: Generating proving key (Phase 2)..."
npx snarkjs groth16 setup \
    "${BUILD_DIR}/${CIRCUIT_NAME}.r1cs" \
    "${BUILD_DIR}/${PTAU_FILE}" \
    "${BUILD_DIR}/${CIRCUIT_NAME}_0000.zkey"

echo "✅ Initial zkey generated"

# Step 4: Contribute to Phase 2 ceremony
echo ""
echo "🎲 Step 4: Contributing entropy..."
npx snarkjs zkey contribute \
    "${BUILD_DIR}/${CIRCUIT_NAME}_0000.zkey" \
    "${BUILD_DIR}/${CIRCUIT_NAME}_0001.zkey" \
    --name="ZK Guardian Dev Contribution" \
    -v -e="$(head -c 64 /dev/urandom | base64)"

# Step 5: Finalize zkey
echo ""
echo "🏁 Step 5: Finalizing zkey..."
npx snarkjs zkey beacon \
    "${BUILD_DIR}/${CIRCUIT_NAME}_0001.zkey" \
    "${BUILD_DIR}/${CIRCUIT_NAME}_final.zkey" \
    "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f" 10 \
    -n="Final Beacon phase2 contribution"

# Step 6: Export verification key
echo ""
echo "📤 Step 6: Exporting verification key..."
npx snarkjs zkey export verificationkey \
    "${BUILD_DIR}/${CIRCUIT_NAME}_final.zkey" \
    "${BUILD_DIR}/verification_key.json"

# Step 7: Generate Solidity verifier
echo ""
echo "📜 Step 7: Generating Solidity verifier..."
npx snarkjs zkey export solidityverifier \
    "${BUILD_DIR}/${CIRCUIT_NAME}_final.zkey" \
    "../contracts/Groth16Verifier.sol"

# Cleanup intermediate files
rm -f "${BUILD_DIR}/${CIRCUIT_NAME}_0000.zkey"
rm -f "${BUILD_DIR}/${CIRCUIT_NAME}_0001.zkey"

echo ""
echo "✅ Trusted setup complete!"
echo ""
echo "Generated files:"
echo "  - ${BUILD_DIR}/${CIRCUIT_NAME}.r1cs"
echo "  - ${BUILD_DIR}/${CIRCUIT_NAME}_js/"
echo "  - ${BUILD_DIR}/${CIRCUIT_NAME}_final.zkey"
echo "  - ${BUILD_DIR}/verification_key.json"
echo "  - ../contracts/Groth16Verifier.sol"
echo ""
echo "⚠️  For production, use a proper multi-party ceremony!"
