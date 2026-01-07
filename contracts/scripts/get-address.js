async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deployer Address:", deployer.address);
}

main().catch(console.error);
