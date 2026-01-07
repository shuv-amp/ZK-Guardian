import { ethers } from 'ethers';
import { zkProofService, AccessRequest } from '../src/services/zkProofService.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Mock the FHIR fetch to avoid needing a HAPI server
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
    console.log("Starting E2E Verification...");

    // 1. Read Deployment Config
    const configPath = path.resolve(__dirname, "../../contracts/local-deployment.json");
    if (!fs.existsSync(configPath)) {
        throw new Error("Local deployment config not found. Run 'deploy-local.js' first.");
    }
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    console.log("Loaded Contract Config:", config);

    // 2. Setup Provider/Wallet
    const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
    // Hardhat Account #0
    const privateKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    const wallet = new ethers.Wallet(privateKey, provider);

    // 3. Prepare Access Request
    const request: AccessRequest = {
        patientId: "123",
        clinicianId: "practitioner-456",
        resourceId: "http://hl7.org/fhir/resource-types/Observation",
        resourceType: "Observation",
        patientNullifier: "1234567890",
        sessionNonce: "987654321"
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
        const auditContract = new ethers.Contract(config.audit, auditAbi, wallet);

        console.log("Submitting to Blockchain...");

        const { proof, publicSignals } = proofResult;

        // DEBUG LOGGING
        console.log("DEBUG: Public Signals Array:");
        publicSignals.forEach((sig, i) => console.log(`Index [${i}]: ${sig}`));

        const tx = await auditContract.verifyAndAudit(proof.a, proof.b, proof.c, publicSignals);
        console.log("Transaction sent:", tx.hash);

        const receipt = await tx.wait();
        console.log("✅ Transaction Confirmed! Block:", receipt.blockNumber);
        console.log("✅ E2E VERIFICATION PASSED");

    } catch (error: any) {
        console.error("❌ E2E VERIFICATION FAILED");
        // console.error(error);
        if (error.data) console.error("Revert Data:", error.data);
        if (error.reason) console.error("Revert Reason:", error.reason);
        if (error.info && error.info.error) console.error("Internal Error:", error.info.error.message);

        process.exit(1);
    }
}

main();
