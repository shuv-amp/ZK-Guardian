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
    // pubSignals: [isValid, blindedPatientId, blindedAccessHash, nullifierHash, proofOfPolicyMatch, currentTimestamp, accessEventHash]
    const genPubSignals = (timestamp, eventHash = "0x1234", nullifier = "123") => [
        "1", // isValid
        "100", // blindedPatientId (dummy)
        "200", // blindedAccessHash (dummy)
        ethers.keccak256(ethers.toUtf8Bytes(nullifier)), // nullifierHash
        "123456", // Policy Hash (proofOfPolicyMatch)
        timestamp,
        ethers.keccak256(ethers.toUtf8Bytes(eventHash)), // Access Event Hash
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
            .withArgs(signals[6], ethers.verifyMessage ? ethers.keccak256(ethers.solidityPacked( // wait, ethers.verifyMessage is for signatures, we just need the hash
                ["uint256[2]", "uint256[2][2]", "uint256[2]", "uint256[7]"],
                [pA, pB, pC, signals]
            )) : ethers.keccak256(ethers.solidityPacked(
                ["uint256[2]", "uint256[2][2]", "uint256[2]", "uint256[7]"],
                [pA, pB, pC, signals]
            )), signals[1], signals[2], nextTime, owner.address);

        // Check storage
        const storedTime = await audit.accessTimestamps(signals[6]);
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

        const signals1 = genPubSignals(nextTime, "event1", "nullifier1");
        const signals2 = genPubSignals(nextTime, "event2", "nullifier2");

        const tx = await audit.batchVerifyAndAudit(
            [pA, pA],
            [pB, pB],
            [pC, pC],
            [signals1, signals2]
        );

        // Should emit 2 events
        await expect(tx).to.emit(audit, "AccessAudited");
        // Verify storage
        expect(await audit.accessTimestamps(signals1[6])).to.equal(nextTime);
        expect(await audit.accessTimestamps(signals2[6])).to.equal(nextTime);
    });

    it("should revert if nullifier is already used (Double-Spend Protection)", async function () {
        const now = await time.latest();
        const nextTime = now + 1;
        await time.setNextBlockTimestamp(nextTime);

        // Use the same nullifier but different event hash
        const signals1 = genPubSignals(nextTime, "event1", "sameNullifier");
        await audit.verifyAndAudit(pA, pB, pC, signals1);

        const nextTime2 = nextTime + 1;
        await time.setNextBlockTimestamp(nextTime2);
        const signals2 = genPubSignals(nextTime2, "event2", "sameNullifier");

        // Should fail because same nullifier
        await expect(
            audit.verifyAndAudit(pA, pB, pC, signals2)
        ).to.be.revertedWithCustomError(audit, "NullifierAlreadyUsed");
    });

    it("should revert if isValid signal is not 1", async function () {
        const now = await time.latest();
        const nextTime = now + 1;
        await time.setNextBlockTimestamp(nextTime);

        const signals = genPubSignals(nextTime);
        signals[0] = "0"; // Set isValid to 0

        await expect(
            audit.verifyAndAudit(pA, pB, pC, signals)
        ).to.be.revertedWithCustomError(audit, "InvalidProof");
    });

    it("should use less than 250,000 gas (Gas Optimization - P1)", async function () {
        const now = await time.latest();
        const nextTime = now + 1;
        await time.setNextBlockTimestamp(nextTime);

        const signals = genPubSignals(nextTime, "gasTest", "gasNullifier");

        const tx = await audit.verifyAndAudit(pA, pB, pC, signals);
        const receipt = await tx.wait();

        // Per SECURITY_AUDIT_CHECKLIST P1: gas < 250,000
        expect(receipt.gasUsed).to.be.lessThan(250000n);
        console.log(`    Gas used: ${receipt.gasUsed.toString()}`);
    });

    it("should revert batch with mismatched array lengths", async function () {
        const now = await time.latest();
        const signals = genPubSignals(now + 1);

        await expect(
            audit.batchVerifyAndAudit(
                [pA, pA], // 2 elements
                [pB],     // 1 element - mismatch
                [pC, pC],
                [signals, signals]
            )
        ).to.be.revertedWithCustomError(audit, "ArrayLengthMismatch");
    });
});
