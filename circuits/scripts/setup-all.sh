#!/bin/bash
# ZK Guardian - Trusted Setup for All Circuits
set -e

CIRCUITS=("AccessIsAllowedSecure" "BreakGlass")
PTAU_FILE="powersOfTau28_hez_final_14.ptau"
PTAU_URL="https://hermez.s3-eu-west-1.amazonaws.com/${PTAU_FILE}"
BUILD_DIR="build"

echo "🔐 ZK Guardian Enterprise Trusted Setup"
echo "======================================"

mkdir -p "${BUILD_DIR}"
cd "$(dirname "$0")/.."

# Step 1: Download Powers of Tau (Common for all)
echo ""
echo "📥 Step 1: Downloading Powers of Tau..."
if [ ! -f "${BUILD_DIR}/${PTAU_FILE}" ]; then
    curl -L "${PTAU_URL}" -o "${BUILD_DIR}/${PTAU_FILE}"
else
    echo "✅ ${PTAU_FILE} already exists"
fi

# Step 2: Process each circuit
for CIRCUIT in "${CIRCUITS[@]}"; do
    echo ""
    echo "----------------------------------------"
    echo "⚙️  Processing: $CIRCUIT"
    echo "----------------------------------------"

    # Compile
    echo "📐 Compiling..."
    circom "${CIRCUIT}.circom" \
        --r1cs --wasm --sym \
        --output $BUILD_DIR \
        -l node_modules \
        -l ../node_modules/circomlib/circuits

    # Generate zkey
    echo "🔑 Generating proving key..."
    npx snarkjs groth16 setup \
        "${BUILD_DIR}/${CIRCUIT}.r1cs" \
        "${BUILD_DIR}/${PTAU_FILE}" \
        "${BUILD_DIR}/${CIRCUIT}_0000.zkey"

    # Contribute
    echo "🎲 Contributing entropy..."
    npx snarkjs zkey contribute \
        "${BUILD_DIR}/${CIRCUIT}_0000.zkey" \
        "${BUILD_DIR}/${CIRCUIT}_0001.zkey" \
        --name="ZK Guardian Auto Setup" \
        -v -e="$(head -c 64 /dev/urandom | base64)"

    # Finalize
    echo "🏁 Finalizing zkey..."
    npx snarkjs zkey beacon \
        "${BUILD_DIR}/${CIRCUIT}_0001.zkey" \
        "${BUILD_DIR}/${CIRCUIT}_final.zkey" \
        "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f" 10 \
        -n="Final Beacon"

    # Export Verification Key
    echo "📤 Exporting verification key..."
    npx snarkjs zkey export verificationkey \
        "${BUILD_DIR}/${CIRCUIT}_final.zkey" \
        "${BUILD_DIR}/${CIRCUIT}_verification_key.json"

    # Export Solidity Verifier
    echo "📜 Generating Solidity verifier..."
    npx snarkjs zkey export solidityverifier \
        "${BUILD_DIR}/${CIRCUIT}_final.zkey" \
        "../contracts/src/${CIRCUIT}Verifier.sol"

    # Rename contract to avoid conflicts (Generic Groth16Verifier -> CircuitSpecificVerifier)
    # Using perl for cross-platform compatibility (mac/linux sed differs)
    perl -i -pe "s/contract Groth16Verifier/contract ${CIRCUIT}Verifier/g" "../contracts/src/${CIRCUIT}Verifier.sol"

    # Cleanup
    rm -f "${BUILD_DIR}/${CIRCUIT}_0000.zkey"
    rm -f "${BUILD_DIR}/${CIRCUIT}_0001.zkey"
done

echo ""
echo "✅ All circuits setup complete!"
echo "   Verifiers generated in ../contracts/contracts/"
