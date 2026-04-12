#!/bin/bash
#
# ZK Guardian - Trusted Setup Script
# Generates the proving and verification keys for ZK circuits
#
# Usage: ./scripts/trusted-setup.sh [circuit_name]
# Example: ./scripts/trusted-setup.sh AccessIsAllowedSecure
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CIRCUITS_DIR="$ROOT_DIR/circuits"
BUILD_DIR="$CIRCUITS_DIR/build"
PTAU_FILE="$CIRCUITS_DIR/powersOfTau28_hez_final_14.ptau"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check dependencies
check_dependencies() {
    log_info "Checking dependencies..."
    
    if ! command -v circom &> /dev/null; then
        log_error "circom is not installed. Please install it first:"
        echo "  cargo install --git https://github.com/iden3/circom.git"
        exit 1
    fi
    
    if ! command -v npx &> /dev/null; then
        log_error "npx is not installed. Please install Node.js and npm."
        exit 1
    fi
    
    log_info "Dependencies OK"
}

# Download PTAU if not present
download_ptau() {
    if [ ! -f "$PTAU_FILE" ]; then
        log_warn "PTAU file not found. Downloading..."
        "$SCRIPT_DIR/download-ptau.sh"
    else
        log_info "PTAU file found: $PTAU_FILE"
    fi
}

# Compile a circuit
compile_circuit() {
    local circuit_name=$1
    local circuit_file="$CIRCUITS_DIR/${circuit_name}.circom"
    local circuit_build_dir="$BUILD_DIR/$circuit_name"
    
    if [ ! -f "$circuit_file" ]; then
        log_error "Circuit file not found: $circuit_file"
        return 1
    fi
    
    log_info "Compiling circuit: $circuit_name"
    
    mkdir -p "$circuit_build_dir"
    
    # Compile to R1CS and WASM
    circom "$circuit_file" \
        --r1cs \
        --wasm \
        --sym \
        --output "$circuit_build_dir" \
        -l "$CIRCUITS_DIR/node_modules"
    
    log_info "Circuit compiled successfully"
}

# Generate proving key
generate_zkey() {
    local circuit_name=$1
    local circuit_build_dir="$BUILD_DIR/$circuit_name"
    local r1cs_file="$circuit_build_dir/${circuit_name}.r1cs"
    local zkey_0="$circuit_build_dir/${circuit_name}_0.zkey"
    local zkey_final="$circuit_build_dir/${circuit_name}_final.zkey"
    
    log_info "Generating proving key for: $circuit_name"
    
    # Phase 2 - Circuit-specific setup
    npx snarkjs groth16 setup "$r1cs_file" "$PTAU_FILE" "$zkey_0"
    
    # Contribute to the ceremony (in production, multiple parties would contribute)
    log_info "Contributing to ceremony..."
    echo "zk-guardian-contribution-$(date +%s)" | npx snarkjs zkey contribute \
        "$zkey_0" \
        "$zkey_final" \
        --name="ZK Guardian Dev" \
        -v
    
    # Cleanup intermediate file
    rm -f "$zkey_0"
    
    log_info "Proving key generated: $zkey_final"
}

# Generate verification key
generate_vkey() {
    local circuit_name=$1
    local circuit_build_dir="$BUILD_DIR/$circuit_name"
    local zkey_final="$circuit_build_dir/${circuit_name}_final.zkey"
    local vkey_file="$circuit_build_dir/${circuit_name}_verification_key.json"
    
    log_info "Exporting verification key for: $circuit_name"
    
    npx snarkjs zkey export verificationkey "$zkey_final" "$vkey_file"
    
    log_info "Verification key exported: $vkey_file"
}

# Generate Solidity verifier
generate_solidity_verifier() {
    local circuit_name=$1
    local circuit_build_dir="$BUILD_DIR/$circuit_name"
    local zkey_final="$circuit_build_dir/${circuit_name}_final.zkey"
    local verifier_file="$ROOT_DIR/contracts/src/${circuit_name}Verifier.sol"
    
    log_info "Generating Solidity verifier for: $circuit_name"
    
    npx snarkjs zkey export solidityverifier "$zkey_final" "$verifier_file"
    
    # Fix the contract name
    sed -i '' "s/contract Groth16Verifier/contract ${circuit_name}Verifier/g" "$verifier_file" 2>/dev/null || \
    sed -i "s/contract Groth16Verifier/contract ${circuit_name}Verifier/g" "$verifier_file"
    
    log_info "Solidity verifier generated: $verifier_file"
}

# Artifacts remain in the canonical build tree
copy_artifacts() {
    local circuit_name=$1
    log_info "Artifacts for ${circuit_name} are available under ${BUILD_DIR}/${circuit_name}"
}

# Main function
main() {
    local circuit_name=$1
    
    if [ -z "$circuit_name" ]; then
        log_info "No circuit specified. Building all circuits..."
        circuits=("AccessIsAllowedSecure" "BreakGlass")
    else
        circuits=("$circuit_name")
    fi
    
    check_dependencies
    download_ptau
    
    for circuit in "${circuits[@]}"; do
        log_info "=========================================="
        log_info "Processing circuit: $circuit"
        log_info "=========================================="
        
        compile_circuit "$circuit"
        generate_zkey "$circuit"
        generate_vkey "$circuit"
        generate_solidity_verifier "$circuit"
        copy_artifacts "$circuit"
        
        log_info "Completed: $circuit"
    done

    if [ -x "$CIRCUITS_DIR/scripts/generate-checksums.sh" ]; then
        "$CIRCUITS_DIR/scripts/generate-checksums.sh"
    else
        bash "$CIRCUITS_DIR/scripts/generate-checksums.sh"
    fi
    
    log_info "=========================================="
    log_info "Trusted setup complete!"
    log_info "=========================================="
}

main "$@"
