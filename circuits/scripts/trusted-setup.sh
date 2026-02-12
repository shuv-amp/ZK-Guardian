#!/bin/bash
# Backward-compatible wrapper.
# Canonical setup flow now runs trusted setup for all production circuits.
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
bash "$SCRIPT_DIR/setup-all.sh"
