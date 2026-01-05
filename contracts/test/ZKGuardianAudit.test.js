const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

describe("ZKGuardianAudit", function () {
    let audit, verifier;
    let owner;

    // Dummy ZK Proof Data
    const pA = [1, 2];
    const pB = [[3, 4], [5, 6]];
    const pC = [7, 8];
    // pubSignals: [policyMatch, timestamp, eventHash, extra]
    const genPubSignals = (timestamp, eventHash = "0x1234") => [
        "123456", // Policy Hash
        timestamp,
        ethers.keccak256(ethers.toUtf8Bytes(eventHash)), // Access Event Hash
        "1" // Extra
    ];

    beforeEach(async function () {
        [owner] = await ethers.getSigners();

        // Deploy Mock Verifier
        const MockVerifier = await ethers.getContractFactory("MockVerifier");
        verifier = await MockVerifier.deploy();

        // Deploy Audit Log
        const ZKGuardianAudit = await ethers.getContractFactory("ZKGuardianAudit");
        audit = await ZKGuardianAudit.deploy(await verifier.getAddress());
    });

    it("should allow a valid proof within time window", async function () {
        const now = await time.latest();
        const nextTime = now + 1;
        await time.setNextBlockTimestamp(nextTime);

        const signals = genPubSignals(nextTime);

        await expect(audit.verifyAndAudit(pA, pB, pC, signals))
            .to.emit(audit, "AccessAudited")
            .withArgs(signals[2], ethers.keccak256(ethers.solidityPacked(
                ["uint256[2]", "uint256[2][2]", "uint256[2]", "uint256[4]"],
                [pA, pB, pC, signals]
            )), nextTime, owner.address);

        // Check storage
        const storedTime = await audit.accessTimestamps(signals[2]);
        expect(storedTime).to.equal(nextTime);
    });

    it("should revert if proof is already used (Replay Protection)", async function () {
        const now = await time.latest();
        const nextTime = now + 1;
        await time.setNextBlockTimestamp(nextTime);

        const signals = genPubSignals(nextTime);

        await audit.verifyAndAudit(pA, pB, pC, signals);

        await expect(
            audit.verifyAndAudit(pA, pB, pC, signals)
        ).to.be.revertedWithCustomError(audit, "ProofAlreadyUsed");
    });

    it("should revert if timestamp is too old", async function () {
        const now = await time.latest();
        const oldTime = now - (5 * 60) - 1; // 5 mins 1 sec ago
        const signals = genPubSignals(oldTime);

        // No need to setNextBlockTimestamp as we expect revert based on argument check
        await expect(
            audit.verifyAndAudit(pA, pB, pC, signals)
        ).to.be.revertedWithCustomError(audit, "InvalidTimestamp");
    });

    it("should revert if timestamp is too far in future", async function () {
        const now = await time.latest();
        const futureTime = now + (5 * 60) + 2; // 5 mins 2 sec in future
        const signals = genPubSignals(futureTime);

        await expect(
            audit.verifyAndAudit(pA, pB, pC, signals)
        ).to.be.revertedWithCustomError(audit, "InvalidTimestamp");
    });

    it("should revert if ZK verification fails", async function () {
        await verifier.setShouldPass(false);
        const now = await time.latest();
        const nextTime = now + 1;
        await time.setNextBlockTimestamp(nextTime);

        const signals = genPubSignals(nextTime);

        await expect(
            audit.verifyAndAudit(pA, pB, pC, signals)
        ).to.be.revertedWithCustomError(audit, "InvalidProof");
    });

    it("should batch verify multiple proofs", async function () {
        const now = await time.latest();
        const nextTime = now + 1;
        await time.setNextBlockTimestamp(nextTime);

        const signals1 = genPubSignals(nextTime, "event1");
        const signals2 = genPubSignals(nextTime, "event2");

        const tx = await audit.batchVerifyAndAudit(
            [pA, pA],
            [pB, pB],
            [pC, pC],
            [signals1, signals2]
        );

        // Should emit 2 events
        await expect(tx).to.emit(audit, "AccessAudited");
        // Verify storage
        expect(await audit.accessTimestamps(signals1[2])).to.equal(nextTime);
        expect(await audit.accessTimestamps(signals2[2])).to.equal(nextTime);
    });
});
