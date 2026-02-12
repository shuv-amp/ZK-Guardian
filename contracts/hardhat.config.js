require("@nomicfoundation/hardhat-toolbox");
require("@openzeppelin/hardhat-upgrades");
require("dotenv").config({ path: "../.env.local" });
require("dotenv").config({ path: "../.env" });

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
    solidity: {
        version: "0.8.24",
        settings: {
            evmVersion: "cancun",
            optimizer: {
                enabled: true,
                runs: 200,
            },
            viaIR: true,
        },
    },
    networks: {
        hardhat: {
            chainId: 31337,
        },
        localhost: {
            url: "http://127.0.0.1:8545",
        },
        amoy: {
            url: process.env.POLYGON_AMOY_RPC || "https://rpc-amoy.polygon.technology",
            accounts: process.env.DEPLOYER_PRIVATE_KEY
                ? [process.env.DEPLOYER_PRIVATE_KEY]
                : [],
            chainId: 80002,
        },
    },
    etherscan: {
        apiKey: {
            polygonAmoy: process.env.POLYGONSCAN_API_KEY || "",
        },
        customChains: [
            {
                network: "polygonAmoy",
                chainId: 80002,
                urls: {
                    apiURL: "https://api-amoy.polygonscan.com/api",
                    browserURL: "https://amoy.polygonscan.com",
                },
            },
        ],
    },
    paths: {
        sources: "./src",
        tests: "./test",
        cache: "./cache",
        artifacts: "./artifacts",
    },
    gasReporter: {
        enabled: true,
        currency: "USD",
    },
};
