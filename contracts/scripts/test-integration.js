const hre = require("hardhat");
const snarkjs = require("snarkjs");
const path = require("path");
const fs = require("fs");

// Import circuit utils
const {
    initPoseidon,
    splitIdToFields,
    stringToFieldElement
} = require("../../circuits/utils/fhirToPoseidon");

async function main() {
    console.log("🚀 Starting End-to-End Integration Test (Localhost)...");

    // Configuration
    const deploymentPath = path.join(__dirname, "../deployment-uups.json");
    if (!fs.existsSync(deploymentPath)) {
        throw new Error("Deployment file not found. Run deploy-uups.js first.");
    }
    const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
    const PROXY_ADDRESS = deployment.ZKGuardianAuditProxy;

    console.log(`Target Proxy Address: ${PROXY_ADDRESS}`);

    const [patient, clinician] = await hre.ethers.getSigners();

    console.log(`Patient: ${patient.address}`);
    console.log(`Clinician: ${clinician.address}`);

    // Initialize Poesidon
    const { poseidon, F } = await initPoseidon();

    // 1. Inputs for the Circuit
    console.log("📝 Generating Valid Inputs...");

    const patientId = splitIdToFields("patient-12345");
    const clinicianId = splitIdToFields("clinician-67890");
    const resourceId = splitIdToFields("observation-abc123");

    // Security parameters
    // Randomize nullifier to prevent NullifierAlreadyUsed error on repeated runs
    const randomVal = Math.floor(Math.random() * 1000000000);
    const patientNullifier = BigInt("9876543210123456789") + BigInt(randomVal);
    const sessionNonce = Math.floor(Math.random() * 1000000000).toString();
    console.log("   Patient Nullifier:", patientNullifier.toString());
    console.log("   Session Nonce:", sessionNonce);

    // Validity window
    const validFrom = Math.floor(new Date("2024-01-01").getTime() / 1000);
    const validTo = Math.floor(new Date("2030-12-31").getTime() / 1000);
    const currentTimestamp = Math.floor(Date.now() / 1000);

    const consentPolicyHash = stringToFieldElement("consent-policy-xyz").toString();
    const resourceHash = F.toString(poseidon([...resourceId]));

    // Allowed categories (at least one must match resourceHash)
    const allowedResourceCategories = [resourceHash, "0", "0", "0", "0", "0", "0", "0"];

    // Compute Pre-Images / Public Inputs
    const proofOfPolicyMatch = F.toString(poseidon([
        BigInt(consentPolicyHash),
        clinicianId[0],
        clinicianId[1],
        BigInt(validFrom),
        BigInt(validTo)
    ]));

    // Access Event Hash (includes nonce)
    // Circuit logic: accessHasher.inputs includes patientId, resourceId, currentTimestamp, sessionNonce
    // accessHasher = Poseidon(10)
    const accessEventHash = F.toString(poseidon([
        ...patientId,
        ...resourceId,
        BigInt(currentTimestamp),
        BigInt(sessionNonce)
    ]));

    const input = {
        patientId: patientId.map(String),
        clinicianId: clinicianId.map(String),
        consentPolicyHash: consentPolicyHash,
        requestedResourceId: resourceId.map(String),
        allowedResourceCategories: allowedResourceCategories,
        validFromTimestamp: String(validFrom),
        validToTimestamp: String(validTo),
        patientNullifier: patientNullifier,
        sessionNonce: sessionNonce,
        proofOfPolicyMatch: proofOfPolicyMatch,
        currentTimestamp: String(currentTimestamp),
        accessEventHash: accessEventHash
    };

    // console.log("   Input:", input);

    const wasmPath = path.join(__dirname, "../../circuits/build/AccessIsAllowedSecure/AccessIsAllowedSecure_js/AccessIsAllowedSecure.wasm");
    const zkeyPath = path.join(__dirname, "../../circuits/build/AccessIsAllowedSecure/AccessIsAllowedSecure_final.zkey");

    if (!fs.existsSync(wasmPath) || !fs.existsSync(zkeyPath)) {
        throw new Error("Circuit artifacts not found! Run setup-all.sh first.");
    }

    console.log("🔐 Proving...");
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
        input,
        wasmPath,
        zkeyPath
    );
    console.log("✅ Proof Generated!");

    // 2. Prepare Call to Contract
    const calldata = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
    const argv = calldata.replace(/["[\]\s]/g, "").split(",");

    const pA = [argv[0], argv[1]];
    const pB = [[argv[2], argv[3]], [argv[4], argv[5]]];
    const pC = [argv[6], argv[7]];
    const pubSignalsArgs = argv.slice(8);

    console.log("   Public Signals Length:", pubSignalsArgs.length);
    console.log("   Public Signals:", pubSignalsArgs);

    if (pubSignalsArgs.length !== 7) {
        throw new Error(`Expected 7 public signals, got ${pubSignalsArgs.length}`);
    }

    console.log("🔌 Connecting to ZKGuardianAudit Proxy...");
    const ZKGuardianAudit = await hre.ethers.getContractFactory("ZKGuardianAudit");
    const contract = ZKGuardianAudit.attach(PROXY_ADDRESS);

    // Debug: Check Verifier Address
    try {
        const verifierAddr = await contract.verifier();
        console.log("   Contract Verifier Address:", verifierAddr);

        // Debug: Direct Verifier Call
        console.log("   Testing Verifier Directly...");
        const VerifierArtifact = await hre.ethers.getContractFactory("AccessIsAllowedSecureVerifier");
        const verifierContract = VerifierArtifact.attach(verifierAddr);

        // Log Expected Signature
        const frag = VerifierArtifact.interface.getFunction("verifyProof");
        console.log(`   Expected Selector: ${frag.selector}`);
        console.log(`   Expected Inputs: ${frag.inputs.map(i => i.type)}`);

        // Check if code exists
        const code = await hre.ethers.provider.getCode(verifierAddr);
        console.log(`   Code Length: ${code.length}`);

        const isValid = await verifierContract.verifyProof(pA, pB, pC, pubSignalsArgs);
        console.log(`   Direct Verify Result: ${isValid}`);

        if (!isValid) throw new Error("Proof verification failed on-chain (Direct Call)");
    } catch (e) {
        console.error("   Verifier check failed:", e.message);
    }

    // 3. Submit Transaction
    console.log("📤 Submitting verifyAndAudit...");
    try {
        const tx = await contract.connect(clinician).verifyAndAudit(pA, pB, pC, pubSignalsArgs);
        console.log(`   Tx Hash: ${tx.hash}`);

        const receipt = await tx.wait();
        console.log(`✅ Transaction Confirmed in Block ${receipt.blockNumber}`);

        // 4. Verify Event
        const logs = await contract.queryFilter(contract.filters.AccessAudited(), receipt.blockNumber);
        if (logs.length > 0) {
            console.log("🎉 AccessAudited Event Emitted!");
            console.log(`   Blinded Patient ID: ${logs[0].args.blindedPatientId}`);
            console.log(`   Timestamp: ${logs[0].args.timestamp}`);

            // Verify accessEventHash matches
            // logs[0].args.accessEventHash is a Hex string (bytes32), accessEventHash is a Decimal string
            if (BigInt(logs[0].args.accessEventHash).toString() === BigInt(accessEventHash).toString()) {
                console.log("✅ Access Event Hash Matches!");
            } else {
                console.error("❌ Access Event Hash Mismatch!");
                console.error("   Contract:", BigInt(logs[0].args.accessEventHash).toString());
                console.error("   Local:   ", BigInt(accessEventHash).toString());
            }
        } else {
            console.error("❌ Event not found (check logs if parsed correctly)");
        }

    } catch (error) {
        console.error("❌ Transaction Failed:", error);
        if (error.data) { // If custom error
            try {
                const decoded = contract.interface.parseError(error.data);
                console.error("   Decoded Error:", decoded.name, decoded.args);
            } catch (e) {
                console.error("   Could not decode error data");
            }
        }
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
