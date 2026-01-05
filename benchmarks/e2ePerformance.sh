#!/bin/bash
# ZK Guardian - End-to-End Performance Test
# Measures real API latency including ZK proof generation

set -e

GATEWAY_URL="${1:-http://localhost:3000}"
ITERATIONS="${2:-20}"

echo "═══════════════════════════════════════════════════════════════"
echo "  ZK Guardian E2E Performance Test"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "Gateway: $GATEWAY_URL"
echo "Iterations: $ITERATIONS"
echo ""

# Check gateway is running
echo "⏳ Checking gateway health..."
if ! curl -s "$GATEWAY_URL/health" > /dev/null; then
    echo "❌ Gateway not responding at $GATEWAY_URL"
    exit 1
fi
echo "✅ Gateway is healthy"
echo ""

# Arrays to store results
declare -a latencies

echo "📊 Running E2E tests..."
echo "────────────────────────────────────────────────────────────────"

for i in $(seq 1 $ITERATIONS); do
    # Time the full request including proof generation
    start_time=$(python3 -c 'import time; print(int(time.time() * 1000))')
    
    response=$(curl -s -w "\n%{http_code}" \
        -H "Authorization: Bearer test-token" \
        -H "Content-Type: application/json" \
        "$GATEWAY_URL/fhir/Patient/patient-123" 2>/dev/null)
    
    end_time=$(python3 -c 'import time; print(int(time.time() * 1000))')
    
    http_code=$(echo "$response" | tail -n1)
    latency=$((end_time - start_time))
    latencies+=($latency)
    
    printf "  Iteration %2d: %4dms (HTTP %s)\n" $i $latency $http_code
done

echo "────────────────────────────────────────────────────────────────"
echo ""

# Calculate statistics
IFS=$'\n' sorted=($(sort -n <<<"${latencies[*]}")); unset IFS

sum=0
for lat in "${latencies[@]}"; do
    sum=$((sum + lat))
done

count=${#latencies[@]}
avg=$((sum / count))
min=${sorted[0]}
max=${sorted[-1]}
median=${sorted[$((count / 2))]}
p95_idx=$((count * 95 / 100))
p95=${sorted[$p95_idx]}

echo "📈 Results:"
echo ""
echo "   Average:  ${avg}ms"
echo "   Median:   ${median}ms"
echo "   P95:      ${p95}ms"
echo "   Min:      ${min}ms"
echo "   Max:      ${max}ms"
echo ""

# Compare against target
TARGET=500
if [ $avg -le $TARGET ]; then
    echo "✅ PASS: Average latency (${avg}ms) is within target (${TARGET}ms)"
else
    echo "❌ FAIL: Average latency (${avg}ms) exceeds target (${TARGET}ms)"
fi

echo ""
echo "═══════════════════════════════════════════════════════════════"

# Save results
cat > benchmarks/e2e_results.json << EOF
{
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "gateway": "$GATEWAY_URL",
  "iterations": $ITERATIONS,
  "results": {
    "avg_ms": $avg,
    "median_ms": $median,
    "p95_ms": $p95,
    "min_ms": $min,
    "max_ms": $max
  },
  "target_ms": $TARGET,
  "passed": $([ $avg -le $TARGET ] && echo "true" || echo "false")
}
EOF

echo "📄 Results saved to benchmarks/e2e_results.json"
