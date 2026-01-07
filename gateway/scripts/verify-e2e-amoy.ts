import { ethers } from 'ethers';
import { zkProofService, AccessRequest } from '../src/services/zkProofService.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env.local explicitly to get keys and addresses
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
// Also load root .env.local for the deployer private key if needed
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

// Mock the FHIR fetch for standalone verification
// @ts-ignore
zkProofService.fetchActiveConsent = async (patientId: string) => {
    console.log(`[Mock] Fetching consent for ${patientId}...`);
    return {
        resourceType: "Consent",
        id: "consent-123",
        status: "active",
        scope: { coding: [{ code: "patient-privacy" }] },
        patient: { reference: `Patient/${patientId}` },
        provision: {
            period: {
                start: "2020-01-01T00:00:00Z",
                end: "2030-01-01T00:00:00Z"
            },
            class: [{ code: "http://hl7.org/fhir/resource-types/Observation" }]
        }
    };
};

async function main() {
    console.log("Starting E2E Verification on Polygon Amoy...");

    // 1. Configuration
    const rpcUrl = process.env.POLYGON_AMOY_RPC || "https://rpc-amoy.polygon.technology";
    const auditAddress = process.env.AUDIT_CONTRACT_ADDRESS;
    // Use DEPLOYER_PRIVATE_KEY from root if available, otherwise GATEWAY_PRIVATE_KEY
    const privateKey = process.env.DEPLOYER_PRIVATE_KEY || process.env.GATEWAY_PRIVATE_KEY;

    if (!auditAddress || !privateKey) {
        throw new Error("Missing AUDIT_CONTRACT_ADDRESS or DEPLOYER_PRIVATE_KEY (or GATEWAY_PRIVATE_KEY) in .env.local");
    }

    console.log(`Target: ${auditAddress}`);
    console.log(`RPC: ${rpcUrl}`);

    // 2. Setup Provider/Wallet
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);

    const balance = await provider.getBalance(wallet.address);
    console.log(`Wallet: ${wallet.address}`);
    console.log(`Balance: ${ethers.formatEther(balance)} POL`);

    // 3. Prepare Access Request
    // Randomize nullifier to ensure uniqueness on every run
    const randomNonce = Math.floor(Math.random() * 1000000).toString();
    const request: AccessRequest = {
        patientId: "123",
        clinicianId: "practitioner-456",
        resourceId: "http://hl7.org/fhir/resource-types/Observation",
        resourceType: "Observation",
        patientNullifier: "1234567890",
        sessionNonce: randomNonce
    };

    try {
        // 4. Generate Proof
        console.log("Generating ZK Proof...");
        await zkProofService.initialize();
        const proofResult = await zkProofService.generateAccessProof(request);
        console.log("Proof Generated!");
        console.log("Proof Hash:", proofResult.proofHash);

        // 5. Submit to Contract
        const auditAbiPath = path.resolve(__dirname, "../../contracts/artifacts/src/ZKGuardianAudit.sol/ZKGuardianAudit.json");
        const auditAbi = JSON.parse(fs.readFileSync(auditAbiPath, 'utf8')).abi;
        const auditContract = new ethers.Contract(auditAddress, auditAbi, wallet);

        console.log("Submitting to Blockchain...");

        const { proof, publicSignals } = proofResult;

        // Estimate gas to fail fast
        try {
            await auditContract.verifyAndAudit.estimateGas(proof.a, proof.b, proof.c, publicSignals);
        } catch (e: any) {
            console.log("Gas estimation failed. Details:", e.reason || e.message);
            // Proceed anyway to see full error or if it's just an RPC quirk
        }

        const tx = await auditContract.verifyAndAudit(proof.a, proof.b, proof.c, publicSignals);
        console.log("Transaction sent:", tx.hash);
        console.log("Waiting for confirmation...");

        const receipt = await tx.wait();
        console.log("✅ Transaction Confirmed! Block:", receipt.blockNumber);
        console.log(`Explorer: https://amoy.polygonscan.com/tx/${tx.hash}`);
        console.log("✅ E2E VERIFICATION ON AMOY PASSED");

    } catch (error: any) {
        console.error("❌ E2E VERIFICATION FAILED");
        if (error.reason) console.error("Revert Reason:", error.reason);
        console.error(error);
        process.exit(1);
    }
}

main();
