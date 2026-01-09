const { ethers, upgrades } = require("hardhat");
const fs = require("fs");
const path = require("path");

const DEPLOYMENT_FILE = path.join(__dirname, "../deployment-uups.json");

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
    console.log("🚀 Starting ZK Guardian Enterprise Deployment (UUPS + Governance)...");

    const [deployer] = await ethers.getSigners();
    console.log("Deployer:", deployer.address);

    const deployed = loadDeployment();

    // 1. Deploy AccessIsAllowedSecureVerifier
    if (!deployed.AccessIsAllowedSecureVerifier) {
        console.log("Deploying Verifier...");
        const Verifier = await ethers.getContractFactory("AccessIsAllowedSecureVerifier");
        const verifier = await Verifier.deploy();
        await verifier.waitForDeployment();
        deployed.AccessIsAllowedSecureVerifier = await verifier.getAddress();
        console.log(`✅ Verifier deployed: ${deployed.AccessIsAllowedSecureVerifier}`);
        saveDeployment(deployed);
    } else {
        console.log(`✅ Verifier exists: ${deployed.AccessIsAllowedSecureVerifier}`);
    }

    // 2. Deploy Timelock
    if (!deployed.ZKGuardianTimelock) {
        console.log("Deploying Timelock...");
        const minDelay = 172800; // 2 days
        const proposers = [deployer.address]; // Initially deployer
        const executors = [ethers.ZeroAddress]; // Anyone can execute
        const admin = deployer.address;

        const Timelock = await ethers.getContractFactory("ZKGuardianTimelock");
        const timelock = await Timelock.deploy(minDelay, proposers, executors, admin);
        await timelock.waitForDeployment();
        deployed.ZKGuardianTimelock = await timelock.getAddress();
        console.log(`✅ Timelock deployed: ${deployed.ZKGuardianTimelock}`);
        saveDeployment(deployed);
    }

    // 3. Deploy Governor
    if (!deployed.ZKGuardianGovernor) {
        console.log("Deploying Governor...");
        // Mock Token for now (IVotes) - Using deployer as token for simplicity in this draft
        // In real app, we need an ERC20Votes token. 
        // For now, we will create a lightweight governance token or assume one exists.
        // Let's create a MockToken inline if needed, or skip governor setup fully and just do Timelock.
        // PLAN: Deploy GovernanceToken first.
    }

    // NOTICE: Skipping Governance Token for now to focus on UUPS core. 
    // We will set Timelock as admin of UUPS.

    // 4. Deploy ZKGuardianAudit (UUPS Proxy)
    if (!deployed.ZKGuardianAuditProxy) {
        console.log("Deploying ZKGuardianAudit UUPS Proxy...");
        const ZKGuardianAudit = await ethers.getContractFactory("ZKGuardianAudit");

        // Initialize with Verifier and Deployer (as admin initially)
        // NOTE: For production, transfer admin to Timelock after setup
        const proxy = await upgrades.deployProxy(ZKGuardianAudit, [
            deployed.AccessIsAllowedSecureVerifier,
            deployer.address // Use deployer for local testing; transfer to Timelock post-setup
        ], {
            initializer: 'initialize',
            kind: 'uups'
        });

        await proxy.waitForDeployment();
        deployed.ZKGuardianAuditProxy = await proxy.getAddress();
        console.log(`✅ ZKGuardianAudit Proxy deployed: ${deployed.ZKGuardianAuditProxy}`);

        // Get Implementation Address
        const impl = await upgrades.erc1967.getImplementationAddress(deployed.ZKGuardianAuditProxy);
        deployed.ZKGuardianAuditImpl = impl;
        console.log(`   Implementation: ${impl}`);

        saveDeployment(deployed);
    } else {
        console.log(`✅ ZKGuardianAudit Proxy exists: ${deployed.ZKGuardianAuditProxy}`);
        console.log("   Checking for upgrades...");

        const ZKGuardianAudit = await ethers.getContractFactory("ZKGuardianAudit");
        // Force upgrade to ensure new functions (setCredentialRegistry) are available
        const proxy = await upgrades.upgradeProxy(deployed.ZKGuardianAuditProxy, ZKGuardianAudit);
        await proxy.waitForDeployment();

        const impl = await upgrades.erc1967.getImplementationAddress(deployed.ZKGuardianAuditProxy);
        deployed.ZKGuardianAuditImpl = impl;
        console.log(`   Upgraded Implementation: ${impl}`);
        saveDeployment(deployed);
    }

    // 5. Deploy BreakGlassVerifier (V2 Feature)
    if (!deployed.BreakGlassVerifier) {
        console.log("Deploying BreakGlassVerifier (Emergency Access)...");
        const BreakGlassVerifier = await ethers.getContractFactory("BreakGlassVerifier");
        const breakGlassVerifier = await BreakGlassVerifier.deploy();
        await breakGlassVerifier.waitForDeployment();
        deployed.BreakGlassVerifier = await breakGlassVerifier.getAddress();
        console.log(`✅ BreakGlassVerifier deployed: ${deployed.BreakGlassVerifier}`);
        saveDeployment(deployed);
    } else {
        console.log(`✅ BreakGlassVerifier exists: ${deployed.BreakGlassVerifier}`);
    }

    // 6. Link BreakGlassVerifier to ZKGuardianAudit
    if (deployed.ZKGuardianAuditProxy && deployed.BreakGlassVerifier && !deployed.BreakGlassVerifierLinked) {
        console.log("Linking BreakGlassVerifier to ZKGuardianAudit...");
        const ZKGuardianAudit = await ethers.getContractFactory("ZKGuardianAudit");
        const auditContract = ZKGuardianAudit.attach(deployed.ZKGuardianAuditProxy);

        const tx = await auditContract.setBreakGlassVerifier(deployed.BreakGlassVerifier);
        await tx.wait();
        deployed.BreakGlassVerifierLinked = true;
        console.log(`✅ BreakGlassVerifier linked to Proxy`);
        saveDeployment(deployed);
    }

    // 7. Deploy CredentialRegistry (V2 Feature - Merkle Root)
    if (!deployed.CredentialRegistryProxy) {
        console.log("Deploying CredentialRegistry UUPS Proxy...");
        const CredentialRegistry = await ethers.getContractFactory("CredentialRegistry");

        const proxy = await upgrades.deployProxy(CredentialRegistry, [
            deployer.address // Admin
        ], {
            initializer: 'initialize',
            kind: 'uups'
        });

        await proxy.waitForDeployment();
        deployed.CredentialRegistryProxy = await proxy.getAddress();
        console.log(`✅ CredentialRegistry Proxy deployed: ${deployed.CredentialRegistryProxy}`);
        saveDeployment(deployed);
    }

    // 8. Link CredentialRegistry to ZKGuardianAudit
    if (deployed.ZKGuardianAuditProxy && deployed.CredentialRegistryProxy && !deployed.CredentialRegistryLinked) {
        console.log("Linking CredentialRegistry to ZKGuardianAudit...");
        const ZKGuardianAudit = await ethers.getContractFactory("ZKGuardianAudit");
        const auditContract = ZKGuardianAudit.attach(deployed.ZKGuardianAuditProxy);

        const tx = await auditContract.setCredentialRegistry(deployed.CredentialRegistryProxy);
        await tx.wait();
        deployed.CredentialRegistryLinked = true;
        console.log(`✅ CredentialRegistry linked to Proxy`);
        saveDeployment(deployed);
    }

    console.log("\n--- Enterprise Deployment Complete ---");
    console.log(`Audit Proxy:         ${deployed.ZKGuardianAuditProxy}`);
    console.log(`BreakGlass Verifier: ${deployed.BreakGlassVerifier}`);
    console.log(`Timelock:            ${deployed.ZKGuardianTimelock}`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
