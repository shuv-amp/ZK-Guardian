const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

const DEPLOYMENT_FILE = path.join(__dirname, "../deployment-amoy.json");

function loadDeployment() {
    if (fs.existsSync(DEPLOYMENT_FILE)) {
        return JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, "utf8"));
    }
    return {};
}

function saveDeployment(data) {
    fs.writeFileSync(DEPLOYMENT_FILE, JSON.stringify(data, null, 2));
}

async function main() {
    console.log("Starting ZK Guardian Deployment...");

    const [deployer] = await hre.ethers.getSigners();
    console.log("Deploying contracts with account:", deployer.address);

    const deployed = loadDeployment();

    // 1. Deploy AccessIsAllowedSecureVerifier
    if (!deployed.AccessIsAllowedSecureVerifier) {
        const SecureVerifier = await hre.ethers.getContractFactory("AccessIsAllowedSecureVerifier");
        const secureVerifier = await SecureVerifier.deploy();
        await secureVerifier.waitForDeployment();
        deployed.AccessIsAllowedSecureVerifier = await secureVerifier.getAddress();
        console.log(`✅ AccessIsAllowedSecureVerifier deployed to: ${deployed.AccessIsAllowedSecureVerifier}`);
        saveDeployment(deployed);
        await new Promise(r => setTimeout(r, 5000)); // Wait 5s
    } else {
        console.log(`✅ AccessIsAllowedSecureVerifier already at: ${deployed.AccessIsAllowedSecureVerifier}`);
    }

    // 2. Deploy BreakGlassVerifier
    if (!deployed.BreakGlassVerifier) {
        const BreakGlassVerifier = await hre.ethers.getContractFactory("BreakGlassVerifier");
        const breakGlassVerifier = await BreakGlassVerifier.deploy();
        await breakGlassVerifier.waitForDeployment();
        deployed.BreakGlassVerifier = await breakGlassVerifier.getAddress();
        console.log(`✅ BreakGlassVerifier deployed to: ${deployed.BreakGlassVerifier}`);
        saveDeployment(deployed);
        await new Promise(r => setTimeout(r, 5000));
    } else {
        console.log(`✅ BreakGlassVerifier already at: ${deployed.BreakGlassVerifier}`);
    }

    // 3. Deploy ConsentRevocationRegistry
    if (!deployed.ConsentRevocationRegistry) {
        const ConsentRevocationRegistry = await hre.ethers.getContractFactory("ConsentRevocationRegistry");
        const registry = await ConsentRevocationRegistry.deploy();
        await registry.waitForDeployment();
        deployed.ConsentRevocationRegistry = await registry.getAddress();
        console.log(`✅ ConsentRevocationRegistry deployed to: ${deployed.ConsentRevocationRegistry}`);
        saveDeployment(deployed);
        await new Promise(r => setTimeout(r, 5000));
    } else {
        console.log(`✅ ConsentRevocationRegistry already at: ${deployed.ConsentRevocationRegistry}`);
    }

    // 4. Deploy ZKGuardianAudit (linked to SecureVerifier)
    if (!deployed.ZKGuardianAudit) {
        const ZKGuardianAudit = await hre.ethers.getContractFactory("ZKGuardianAudit");
        const audit = await ZKGuardianAudit.deploy(deployed.AccessIsAllowedSecureVerifier);
        await audit.waitForDeployment();
        deployed.ZKGuardianAudit = await audit.getAddress();
        console.log(`✅ ZKGuardianAudit deployed to: ${deployed.ZKGuardianAudit}`);
        saveDeployment(deployed);
    } else {
        console.log(`✅ ZKGuardianAudit already at: ${deployed.ZKGuardianAudit}`);
    }

    console.log("\n--- Deployment Summary ---");
    console.log(`Secure Verifier: ${deployed.AccessIsAllowedSecureVerifier}`);
    console.log(`BreakGlass Ver:  ${deployed.BreakGlassVerifier}`);
    console.log(`Audit Log:       ${deployed.ZKGuardianAudit}`);
    console.log(`Registry:        ${deployed.ConsentRevocationRegistry}`);

    // Verification Logic (Only runs if manually requested or re-run)
    if (hre.network.name === "amoy") {
        console.log("\n Skipping automatic verification to save time/gas. Use verify script manually.");
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
