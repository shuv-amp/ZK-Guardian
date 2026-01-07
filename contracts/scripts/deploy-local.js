const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
    console.log("Starting Local Deployment...");

    const [deployer] = await hre.ethers.getSigners();
    console.log("Deploying contracts with local account:", deployer.address);

    // 1. Deploy AccessIsAllowedSecureVerifier
    const SecureVerifier = await hre.ethers.getContractFactory("AccessIsAllowedSecureVerifier");
    const secureVerifier = await SecureVerifier.deploy();
    await secureVerifier.waitForDeployment();
    const secureVerifierAddress = await secureVerifier.getAddress();
    console.log("AccessIsAllowedSecureVerifier deployed to:", secureVerifierAddress);

    // 2. Deploy BreakGlassVerifier
    const BreakGlassVerifier = await hre.ethers.getContractFactory("BreakGlassVerifier");
    const breakGlassVerifier = await BreakGlassVerifier.deploy();
    await breakGlassVerifier.waitForDeployment();
    const breakGlassVerifierAddress = await breakGlassVerifier.getAddress();
    console.log("BreakGlassVerifier deployed to:", breakGlassVerifierAddress);

    // 3. Deploy ConsentRevocationRegistry
    const Registry = await hre.ethers.getContractFactory("ConsentRevocationRegistry");
    const registry = await Registry.deploy();
    await registry.waitForDeployment();
    const registryAddress = await registry.getAddress();
    console.log("ConsentRevocationRegistry deployed to:", registryAddress);

    // 4. Deploy ZKGuardianAudit (linked to SecureVerifier)
    const Audit = await hre.ethers.getContractFactory("ZKGuardianAudit");
    const audit = await Audit.deploy(secureVerifierAddress);
    await audit.waitForDeployment();
    const auditAddress = await audit.getAddress();
    console.log("ZKGuardianAudit deployed to:", auditAddress);

    // Output for Gateway .env.local
    console.log("\n=== Configuration for Gateway .env.local ===");
    console.log(`AUDIT_CONTRACT_ADDRESS=${auditAddress}`);
    console.log(`CONSENT_REVOCATION_REGISTRY_ADDRESS=${registryAddress}`);
    console.log(`POLYGON_AMOY_RPC=http://127.0.0.1:8545`);
    console.log("============================================\n");

    // Save to file for easy reading by verify script if we want
    const config = {
        audit: auditAddress,
        registry: registryAddress,
        verifier: secureVerifierAddress
    };
    fs.writeFileSync(path.join(__dirname, "../local-deployment.json"), JSON.stringify(config, null, 2));
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
