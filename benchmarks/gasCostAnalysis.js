#!/usr/bin/env node
/**
 * ZK Guardian Gas Cost Analysis
 * 
 * Estimates gas costs for on-chain operations using Hardhat.
 * 
 * Run: npx hardhat run benchmarks/gasCostAnalysis.js --network amoy
 */

const hre = require('hardhat');

async function main() {
    console.log('═'.repeat(60));
    console.log('  ZK Guardian Gas Cost Analysis');
    console.log('═'.repeat(60));
    console.log('');

    // Get network info
    const network = await hre.ethers.provider.getNetwork();
    const gasPrice = await hre.ethers.provider.getFeeData();

    console.log(`Network: ${network.name} (chainId: ${network.chainId})`);
    console.log(`Gas Price: ${hre.ethers.formatUnits(gasPrice.gasPrice || 0n, 'gwei')} gwei\n`);

    // Estimated gas costs (from Groth16 verifier measurements)
    const gasCosts = {
        singleProofVerification: 280000n,
        batchProofSubmission_10: 1500000n,
        auditEventRecord: 50000n,
        consentUpdate: 45000n
    };

    const maticPrice = 0.90; // USD (update as needed)
    const gweiPerMatic = 1e9;

    console.log('📊 Estimated Gas Costs:');
    console.log('─'.repeat(60));

    for (const [operation, gas] of Object.entries(gasCosts)) {
        const gasPriceGwei = gasPrice.gasPrice || 30000000000n; // 30 gwei fallback
        const costWei = gas * gasPriceGwei;
        const costMatic = Number(hre.ethers.formatEther(costWei));
        const costUSD = costMatic * maticPrice;

        console.log(`${operation}:`);
        console.log(`   Gas:  ${gas.toLocaleString()}`);
        console.log(`   Cost: ${costMatic.toFixed(6)} MATIC (~$${costUSD.toFixed(4)})\n`);
    }

    // Batch savings calculation
    const singleFor10 = Number(gasCosts.singleProofVerification) * 10;
    const batchFor10 = Number(gasCosts.batchProofSubmission_10);
    const savings = ((singleFor10 - batchFor10) / singleFor10 * 100).toFixed(1);

    console.log('─'.repeat(60));
    console.log(`🔋 Batch Optimization:`);
    console.log(`   10 individual proofs: ${singleFor10.toLocaleString()} gas`);
    console.log(`   Batched (10 proofs):  ${batchFor10.toLocaleString()} gas`);
    console.log(`   Savings: ${savings}%\n`);

    // Monthly cost projection
    console.log('─'.repeat(60));
    console.log('📅 Monthly Cost Projection (1000 accesses/day):');

    const dailyAccesses = 1000;
    const batchSize = 10;
    const batchesPerDay = Math.ceil(dailyAccesses / batchSize);
    const gasPriceGwei = Number(hre.ethers.formatUnits(gasPrice.gasPrice || 30000000000n, 'gwei'));

    const dailyGas = batchesPerDay * Number(gasCosts.batchProofSubmission_10);
    const dailyCostMatic = (dailyGas * gasPriceGwei) / gweiPerMatic;
    const monthlyCostMatic = dailyCostMatic * 30;
    const monthlyCostUSD = monthlyCostMatic * maticPrice;

    console.log(`   Batches per day: ${batchesPerDay}`);
    console.log(`   Daily gas:       ${dailyGas.toLocaleString()}`);
    console.log(`   Daily cost:      ${dailyCostMatic.toFixed(4)} MATIC (~$${(dailyCostMatic * maticPrice).toFixed(2)})`);
    console.log(`   Monthly cost:    ${monthlyCostMatic.toFixed(2)} MATIC (~$${monthlyCostUSD.toFixed(2)})\n`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
