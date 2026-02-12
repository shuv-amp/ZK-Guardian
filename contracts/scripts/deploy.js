const hre = require("hardhat");
const { ethers, upgrades } = hre;
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
    console.log("Starting ZK Guardian deployment...");

    const [deployer] = await ethers.getSigners();
    if (!deployer) {
        throw new Error(
            "No deployer account configured. Set DEPLOYER_PRIVATE_KEY in .env.local or .env and fund it on Amoy."
        );
    }
    console.log("Deployer:", deployer.address);

    const deployed = loadDeployment();

    // 1) Access verifier
    if (!deployed.AccessIsAllowedSecureVerifier) {
        const SecureVerifier = await ethers.getContractFactory("AccessIsAllowedSecureVerifier");
        const secureVerifier = await SecureVerifier.deploy();
        await secureVerifier.waitForDeployment();
        deployed.AccessIsAllowedSecureVerifier = await secureVerifier.getAddress();
        console.log(`AccessIsAllowedSecureVerifier: ${deployed.AccessIsAllowedSecureVerifier}`);
        saveDeployment(deployed);
    } else {
        console.log(`AccessIsAllowedSecureVerifier exists: ${deployed.AccessIsAllowedSecureVerifier}`);
    }

    // 2) Break-glass verifier
    if (!deployed.BreakGlassVerifier) {
        const BreakGlassVerifier = await ethers.getContractFactory("BreakGlassVerifier");
        const breakGlassVerifier = await BreakGlassVerifier.deploy();
        await breakGlassVerifier.waitForDeployment();
        deployed.BreakGlassVerifier = await breakGlassVerifier.getAddress();
        console.log(`BreakGlassVerifier: ${deployed.BreakGlassVerifier}`);
        saveDeployment(deployed);
    } else {
        console.log(`BreakGlassVerifier exists: ${deployed.BreakGlassVerifier}`);
    }

    // 3) Consent revocation registry (non-upgradeable)
    if (!deployed.ConsentRevocationRegistry) {
        const ConsentRevocationRegistry = await ethers.getContractFactory("ConsentRevocationRegistry");
        const registry = await ConsentRevocationRegistry.deploy();
        await registry.waitForDeployment();
        deployed.ConsentRevocationRegistry = await registry.getAddress();
        console.log(`ConsentRevocationRegistry: ${deployed.ConsentRevocationRegistry}`);
        saveDeployment(deployed);
    } else {
        console.log(`ConsentRevocationRegistry exists: ${deployed.ConsentRevocationRegistry}`);
    }

    // 4) Credential registry (UUPS)
    if (!deployed.CredentialRegistryProxy) {
        const CredentialRegistry = await ethers.getContractFactory("CredentialRegistry");
        const credentialRegistry = await upgrades.deployProxy(
            CredentialRegistry,
            [deployer.address],
            { initializer: "initialize", kind: "uups" }
        );
        await credentialRegistry.waitForDeployment();
        deployed.CredentialRegistryProxy = await credentialRegistry.getAddress();
        console.log(`CredentialRegistryProxy: ${deployed.CredentialRegistryProxy}`);
        saveDeployment(deployed);
    } else {
        console.log(`CredentialRegistryProxy exists: ${deployed.CredentialRegistryProxy}`);
    }

    // 5) Audit contract (UUPS)
    if (!deployed.ZKGuardianAuditProxy) {
        const Audit = await ethers.getContractFactory("ZKGuardianAudit");
        const proxy = await upgrades.deployProxy(
            Audit,
            [deployed.AccessIsAllowedSecureVerifier, deployer.address],
            { initializer: "initialize", kind: "uups" }
        );
        await proxy.waitForDeployment();
        deployed.ZKGuardianAuditProxy = await proxy.getAddress();
        deployed.ZKGuardianAudit = deployed.ZKGuardianAuditProxy; // backward compatibility
        deployed.ZKGuardianAuditImpl = await upgrades.erc1967.getImplementationAddress(deployed.ZKGuardianAuditProxy);
        console.log(`ZKGuardianAuditProxy: ${deployed.ZKGuardianAuditProxy}`);
        console.log(`ZKGuardianAuditImpl:  ${deployed.ZKGuardianAuditImpl}`);
        saveDeployment(deployed);
    } else {
        deployed.ZKGuardianAudit = deployed.ZKGuardianAuditProxy;
        console.log(`ZKGuardianAuditProxy exists: ${deployed.ZKGuardianAuditProxy}`);
        saveDeployment(deployed);
    }

    // 6) Link break-glass dependencies
    const Audit = await ethers.getContractFactory("ZKGuardianAudit");
    const audit = Audit.attach(deployed.ZKGuardianAuditProxy);

    const currentBreakGlassVerifier = await audit.breakGlassVerifier();
    if (currentBreakGlassVerifier.toLowerCase() !== deployed.BreakGlassVerifier.toLowerCase()) {
        await (await audit.setBreakGlassVerifier(deployed.BreakGlassVerifier)).wait();
        console.log(`Linked BreakGlassVerifier -> ${deployed.BreakGlassVerifier}`);
    }

    const currentCredentialRegistry = await audit.credentialRegistry();
    if (currentCredentialRegistry.toLowerCase() !== deployed.CredentialRegistryProxy.toLowerCase()) {
        await (await audit.setCredentialRegistry(deployed.CredentialRegistryProxy)).wait();
        console.log(`Linked CredentialRegistry -> ${deployed.CredentialRegistryProxy}`);
    }

    console.log("\n--- Deployment Summary ---");
    console.log(`Audit Proxy:                 ${deployed.ZKGuardianAuditProxy}`);
    console.log(`Access Verifier:             ${deployed.AccessIsAllowedSecureVerifier}`);
    console.log(`BreakGlass Verifier:         ${deployed.BreakGlassVerifier}`);
    console.log(`ConsentRevocationRegistry:   ${deployed.ConsentRevocationRegistry}`);
    console.log(`CredentialRegistry Proxy:    ${deployed.CredentialRegistryProxy}`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
