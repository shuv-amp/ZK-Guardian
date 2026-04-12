#!/bin/bash
# ZK Guardian - Trusted Setup for All Circuits
set -e

CIRCUITS=("AccessIsAllowedSecure" "BreakGlass")
PTAU_FILE="powersOfTau28_hez_final_14.ptau"
PTAU_URL="https://storage.googleapis.com/zkevm/ptau/${PTAU_FILE}"
BUILD_DIR="build"

echo "🔐 ZK Guardian Enterprise Trusted Setup"
echo "======================================"

mkdir -p "${BUILD_DIR}"
cd "$(dirname "$0")/.."

ptau_size() {
    stat -f%z "$1" 2>/dev/null || stat -c%s "$1" 2>/dev/null
}

# Step 1: Download Powers of Tau (Common for all)
echo ""
echo "📥 Step 1: Downloading Powers of Tau..."
if [ -f "${BUILD_DIR}/${PTAU_FILE}" ]; then
    CURRENT_SIZE=$(ptau_size "${BUILD_DIR}/${PTAU_FILE}")
    if [ -z "${CURRENT_SIZE}" ] || [ "${CURRENT_SIZE}" -lt 1000000 ]; then
        echo "⚠️  Cached PTAU file is invalid (${CURRENT_SIZE:-unknown} bytes). Re-downloading..."
        rm -f "${BUILD_DIR}/${PTAU_FILE}"
    fi
fi

if [ ! -f "${BUILD_DIR}/${PTAU_FILE}" ]; then
    curl -fL "${PTAU_URL}" -o "${BUILD_DIR}/${PTAU_FILE}"
else
    echo "✅ ${PTAU_FILE} already exists"
fi

CURRENT_SIZE=$(ptau_size "${BUILD_DIR}/${PTAU_FILE}")
if [ -z "${CURRENT_SIZE}" ] || [ "${CURRENT_SIZE}" -lt 1000000 ]; then
    echo "❌ PTAU download looks invalid (${CURRENT_SIZE:-unknown} bytes)"
    exit 1
fi

# Step 2: Process each circuit
for CIRCUIT in "${CIRCUITS[@]}"; do
    CIRCUIT_BUILD_DIR="${BUILD_DIR}/${CIRCUIT}"
    echo ""
    echo "----------------------------------------"
    echo "⚙️  Processing: $CIRCUIT"
    echo "----------------------------------------"

    # Compile
    echo "📐 Compiling..."
    mkdir -p "${CIRCUIT_BUILD_DIR}"
    circom "${CIRCUIT}.circom" \
        --r1cs --wasm --sym \
        --output "${CIRCUIT_BUILD_DIR}" \
        -l node_modules \
        -l ../node_modules/circomlib/circuits

    # Generate zkey
    echo "🔑 Generating proving key..."
    npx snarkjs groth16 setup \
        "${CIRCUIT_BUILD_DIR}/${CIRCUIT}.r1cs" \
        "${BUILD_DIR}/${PTAU_FILE}" \
        "${CIRCUIT_BUILD_DIR}/${CIRCUIT}_0000.zkey"

    # Contribute
    echo "🎲 Contributing entropy..."
    npx snarkjs zkey contribute \
        "${CIRCUIT_BUILD_DIR}/${CIRCUIT}_0000.zkey" \
        "${CIRCUIT_BUILD_DIR}/${CIRCUIT}_0001.zkey" \
        --name="ZK Guardian Auto Setup" \
        -v -e="$(head -c 64 /dev/urandom | base64)"

    # Finalize
    echo "🏁 Finalizing zkey..."
    npx snarkjs zkey beacon \
        "${CIRCUIT_BUILD_DIR}/${CIRCUIT}_0001.zkey" \
        "${CIRCUIT_BUILD_DIR}/${CIRCUIT}_final.zkey" \
        "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f" 10 \
        -n="Final Beacon"

    # Export Verification Key
    echo "📤 Exporting verification key..."
    npx snarkjs zkey export verificationkey \
        "${CIRCUIT_BUILD_DIR}/${CIRCUIT}_final.zkey" \
        "${CIRCUIT_BUILD_DIR}/${CIRCUIT}_verification_key.json"

    # Export Solidity Verifier
    echo "📜 Generating Solidity verifier..."
    npx snarkjs zkey export solidityverifier \
        "${CIRCUIT_BUILD_DIR}/${CIRCUIT}_final.zkey" \
        "../contracts/src/${CIRCUIT}Verifier.sol"

    # Rename contract to avoid conflicts (Generic Groth16Verifier -> CircuitSpecificVerifier)
    # Using perl for cross-platform compatibility (mac/linux sed differs)
    perl -i -pe "s/contract Groth16Verifier/contract ${CIRCUIT}Verifier/g" "../contracts/src/${CIRCUIT}Verifier.sol"

    # Cleanup
    rm -f "${CIRCUIT_BUILD_DIR}/${CIRCUIT}_0000.zkey"
    rm -f "${CIRCUIT_BUILD_DIR}/${CIRCUIT}_0001.zkey"
done

echo ""
echo "🧾 Generating checksums..."
bash scripts/generate-checksums.sh

echo ""
echo "✅ All circuits setup complete!"
echo "   Verifiers generated in ../contracts/src/"
