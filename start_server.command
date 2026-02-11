#!/bin/bash
cd "$(dirname "$0")"
echo "Starting ZK Guardian Gateway..."
echo "--------------------------------"
pnpm gateway:dev
