#!/bin/bash
# Backward-compatible wrapper.
# Canonical compile flow now builds both production circuits.
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
bash "$SCRIPT_DIR/compile-all.sh"
