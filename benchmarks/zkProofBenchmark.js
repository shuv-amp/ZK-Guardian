#!/usr/bin/env node
/**
 * ZK Guardian Performance Benchmarks
 * 
 * Measures:
 * 1. ZK Proof Generation Time
 * 2. End-to-End Access Request Latency
 * 3. Circuit Constraints Count
 * 
 * Run: node benchmarks/zkProofBenchmark.js
 */

const snarkjs = require('snarkjs');
const path = require('path');
const fs = require('fs');

// Configuration
const BUILD_DIR = path.join(__dirname, '../circuits/build');
const WASM_FILE = path.join(BUILD_DIR, 'AccessIsAllowed_js/AccessIsAllowed.wasm');
const ZKEY_FILE = path.join(BUILD_DIR, 'AccessIsAllowed_final.zkey');
const VERIFICATION_KEY = path.join(BUILD_DIR, 'verification_key.json');

// Test inputs
const SAMPLE_INPUT = {
    nullifier: "12345678901234567890123456789012",
    allowedResourceCategories: [1, 2, 3, 0, 0, 0, 0, 0],  // 3 categories
    patientPubKey: ["123456789", "987654321"],
    clinicianPubKey: ["111111111", "222222222"],
    sessionNonce: "999888777666",
    consentValidFrom: 1704067200,  // 2024-01-01
    consentValidUntil: 1735689600, // 2024-12-31
    timestamp: 1720000000,         // Mid-2024
    requestedResourceCategory: 1   // In allowed list
};

// Results storage
const results = {
    proofGeneration: [],
    verification: [],
    witnessCalculation: []
};

async function checkFilesExist() {
    const files = [WASM_FILE, ZKEY_FILE, VERIFICATION_KEY];
    const missing = files.filter(f => !fs.existsSync(f));

    if (missing.length > 0) {
        console.error('❌ Missing circuit files. Run trusted-setup.sh first:');
        missing.forEach(f => console.error(`   - ${f}`));
        process.exit(1);
    }
}

async function benchmarkProofGeneration(iterations = 10) {
    console.log(`\n⏱️  Benchmarking Proof Generation (${iterations} iterations)...\n`);

    for (let i = 0; i < iterations; i++) {
        const startWitness = performance.now();

        // Generate witness
        const { witness } = await snarkjs.wtns.calculate(
            SAMPLE_INPUT,
            WASM_FILE
        );

        const witnessTime = performance.now() - startWitness;
        results.witnessCalculation.push(witnessTime);

        // Generate proof
        const startProof = performance.now();
        const { proof, publicSignals } = await snarkjs.groth16.fullProve(
            SAMPLE_INPUT,
            WASM_FILE,
            ZKEY_FILE
        );
        const proofTime = performance.now() - startProof;
        results.proofGeneration.push(proofTime);

        // Verify
        const vKey = JSON.parse(fs.readFileSync(VERIFICATION_KEY, 'utf-8'));
        const startVerify = performance.now();
        const verified = await snarkjs.groth16.verify(vKey, publicSignals, proof);
        const verifyTime = performance.now() - startVerify;
        results.verification.push(verifyTime);

        if (!verified) {
            console.error(`❌ Iteration ${i + 1}: Verification FAILED`);
        } else {
            console.log(`   ✓ Iteration ${i + 1}: proof=${proofTime.toFixed(0)}ms, verify=${verifyTime.toFixed(0)}ms`);
        }
    }
}

function calculateStats(arr) {
    const sorted = [...arr].sort((a, b) => a - b);
    const sum = arr.reduce((a, b) => a + b, 0);
    return {
        min: sorted[0],
        max: sorted[sorted.length - 1],
        avg: sum / arr.length,
        median: sorted[Math.floor(sorted.length / 2)],
        p95: sorted[Math.floor(sorted.length * 0.95)]
    };
}

function printResults() {
    console.log('\n' + '='.repeat(60));
    console.log('📊 BENCHMARK RESULTS');
    console.log('='.repeat(60));

    const proofStats = calculateStats(results.proofGeneration);
    const verifyStats = calculateStats(results.verification);
    const witnessStats = calculateStats(results.witnessCalculation);

    console.log('\n🔐 Proof Generation:');
    console.log(`   Average:  ${proofStats.avg.toFixed(2)} ms`);
    console.log(`   Median:   ${proofStats.median.toFixed(2)} ms`);
    console.log(`   P95:      ${proofStats.p95.toFixed(2)} ms`);
    console.log(`   Range:    ${proofStats.min.toFixed(2)} - ${proofStats.max.toFixed(2)} ms`);

    console.log('\n✅ Verification:');
    console.log(`   Average:  ${verifyStats.avg.toFixed(2)} ms`);
    console.log(`   Median:   ${verifyStats.median.toFixed(2)} ms`);

    console.log('\n📝 Witness Calculation:');
    console.log(`   Average:  ${witnessStats.avg.toFixed(2)} ms`);

    // Compare against targets
    console.log('\n' + '='.repeat(60));
    console.log('🎯 TARGET COMPARISON');
    console.log('='.repeat(60));

    const targets = [
        { name: 'Proof Generation', value: proofStats.avg, target: 3000, unit: 'ms' },
        { name: 'Verification', value: verifyStats.avg, target: 10, unit: 'ms' }
    ];

    targets.forEach(t => {
        const status = t.value <= t.target ? '✅ PASS' : '❌ FAIL';
        const pct = ((t.value / t.target) * 100).toFixed(1);
        console.log(`   ${t.name}: ${t.value.toFixed(2)}${t.unit} / ${t.target}${t.unit} (${pct}%) ${status}`);
    });

    console.log('\n');
}

async function main() {
    console.log('═'.repeat(60));
    console.log('  ZK Guardian Performance Benchmarks');
    console.log('═'.repeat(60));

    await checkFilesExist();
    await benchmarkProofGeneration(10);
    printResults();

    // Save results to file
    const output = {
        timestamp: new Date().toISOString(),
        iterations: 10,
        proofGeneration: calculateStats(results.proofGeneration),
        verification: calculateStats(results.verification),
        witnessCalculation: calculateStats(results.witnessCalculation)
    };

    fs.writeFileSync(
        path.join(__dirname, 'benchmark_results.json'),
        JSON.stringify(output, null, 2)
    );
    console.log('📄 Results saved to benchmarks/benchmark_results.json\n');
}

main().catch(console.error);
