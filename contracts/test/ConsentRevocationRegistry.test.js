const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

describe("ConsentRevocationRegistry", function () {
    let registry;
    let owner, revoker, user;
    const REVOKER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("REVOKER_ROLE"));
    const SAMPLE_HASH = "0x1234567890123456789012345678901234567890123456789012345678901234";

    beforeEach(async function () {
        [owner, revoker, user] = await ethers.getSigners();

        const Registry = await ethers.getContractFactory("ConsentRevocationRegistry");
        registry = await Registry.deploy();

        // Grant revoker role
        await registry.grantRole(REVOKER_ROLE, revoker.address);
    });

    it("should allow authorized revoker to revoke consent", async function () {
        const nextTime = await time.latest() + 1;
        await time.setNextBlockTimestamp(nextTime);

        await expect(registry.connect(revoker).revokeConsent(SAMPLE_HASH, "Policy Violation"))
            .to.emit(registry, "ConsentRevoked")
            .withArgs(SAMPLE_HASH, revoker.address, "Policy Violation", nextTime);

        expect(await registry.isRevoked(SAMPLE_HASH)).to.be.true;
    });

    it("should prevent unauthorized users from revoking", async function () {
        await expect(
            registry.connect(user).revokeConsent(SAMPLE_HASH, "Hack")
        ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    });

    it("should allow restoring consent", async function () {
        await registry.connect(revoker).revokeConsent(SAMPLE_HASH, "Mistake");

        const nextTime = await time.latest() + 1;
        await time.setNextBlockTimestamp(nextTime);

        await expect(registry.connect(revoker).restoreConsent(SAMPLE_HASH))
            .to.emit(registry, "ConsentRestored")
            .withArgs(SAMPLE_HASH, revoker.address, nextTime);

        expect(await registry.isRevoked(SAMPLE_HASH)).to.be.false;
    });

    it("should revert if already revoked", async function () {
        await registry.connect(revoker).revokeConsent(SAMPLE_HASH, "First");

        await expect(
            registry.connect(revoker).revokeConsent(SAMPLE_HASH, "Second")
        ).to.be.revertedWithCustomError(registry, "ConsentAlreadyRevoked");
    });

    it("should batch check statuses", async function () {
        const hash2 = "0xABCDEF";
        const hash2Bytes = ethers.zeroPadValue(hash2, 32);

        await registry.connect(revoker).revokeConsent(SAMPLE_HASH, "Reason");

        const statuses = await registry.checkRevocationStatus([SAMPLE_HASH, hash2Bytes]);
        expect(statuses[0]).to.be.true;
        expect(statuses[1]).to.be.false;
    });
});
