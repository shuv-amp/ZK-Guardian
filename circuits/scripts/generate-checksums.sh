#!/bin/bash
# ZK Guardian - Generate circuit checksums
set -e

BUILD_DIR="build"
OUTPUT_FILE="../checksums.sha256"

if [ ! -d "${BUILD_DIR}" ]; then
    echo "Missing ${BUILD_DIR}. Run setup-all.sh first." >&2
    exit 1
fi

FILES=(
    "${BUILD_DIR}/AccessIsAllowedSecure/AccessIsAllowedSecure_js/AccessIsAllowedSecure.wasm"
    "${BUILD_DIR}/AccessIsAllowedSecure/AccessIsAllowedSecure_final.zkey"
    "${BUILD_DIR}/AccessIsAllowedSecure/AccessIsAllowedSecure_verification_key.json"
    "${BUILD_DIR}/BreakGlass/BreakGlass_js/BreakGlass.wasm"
    "${BUILD_DIR}/BreakGlass/BreakGlass_final.zkey"
    "${BUILD_DIR}/BreakGlass/BreakGlass_verification_key.json"
)

cd "$(dirname "$0")/.."

echo "# ZK Guardian circuit checksums" > "${OUTPUT_FILE}"

for file in "${FILES[@]}"; do
    if [ ! -f "$file" ]; then
        echo "Missing file: $file" >&2
        exit 1
    fi

    shasum -a 256 "$file" >> "${OUTPUT_FILE}"
done

echo "✅ Checksums written to ${OUTPUT_FILE}"
