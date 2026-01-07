const hre = require("hardhat");
require('dotenv').config({ path: '.env.local' });

async function main() {
    const [deployer] = await hre.ethers.getSigners();
    const balance = await hre.ethers.provider.getBalance(deployer.address);
    console.log(`Address: ${deployer.address}`);
    console.log(`Balance: ${hre.ethers.formatEther(balance)} POL`);
}

main().catch(console.error);
