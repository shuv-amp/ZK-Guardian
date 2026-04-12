#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="${ROOT_DIR}/build"

REQUIRED_FILES=(
  "${BUILD_DIR}/AccessIsAllowedSecure/AccessIsAllowedSecure_js/AccessIsAllowedSecure.wasm"
  "${BUILD_DIR}/AccessIsAllowedSecure/AccessIsAllowedSecure_final.zkey"
  "${BUILD_DIR}/AccessIsAllowedSecure/AccessIsAllowedSecure_verification_key.json"
  "${BUILD_DIR}/BreakGlass/BreakGlass_js/BreakGlass.wasm"
  "${BUILD_DIR}/BreakGlass/BreakGlass_final.zkey"
  "${BUILD_DIR}/BreakGlass/BreakGlass_verification_key.json"
)

MISSING=0
for file in "${REQUIRED_FILES[@]}"; do
  if [ ! -f "${file}" ]; then
    echo "Missing circuit artifact: ${file}" >&2
    MISSING=1
  fi
done

if [ "${MISSING}" -ne 0 ]; then
  echo "" >&2
  echo "Circuit artifacts are required before running circuit tests." >&2
  echo "Run 'pnpm circuits:setup' from the repository root after installing circom." >&2
  exit 1
fi
