const ethers = require('ethers');
require('dotenv').config({ path: '.env.local' });

async function main() {
    const key = process.env.DEPLOYER_PRIVATE_KEY;
    if (!key) {
        console.log("No DEPLOYER_PRIVATE_KEY found in .env");
        return;
    }
    const wallet = new ethers.Wallet(key);
    console.log("Deployer Address:", wallet.address);
}

main().catch(console.error);
