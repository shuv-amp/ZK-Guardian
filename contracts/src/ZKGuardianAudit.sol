// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

interface IGroth16Verifier {
    function verifyProof(
        uint256[2] calldata _pA,
        uint256[2][2] calldata _pB,
        uint256[2] calldata _pC,
        uint256[4] calldata _pubSignals
    ) external view returns (bool);
}

/**
 * @title ZKGuardianAudit
 * @notice Gas-optimized audit log for ZK-protected healthcare access.
 * @dev Verifies Groth16 proofs and logs access events on-chain.
 *      Implements strict replay protection and timestamp validation.
 */
contract ZKGuardianAudit {
    // === Constants ===
    uint256 private constant TIMESTAMP_THRESHOLD = 5 minutes; // Preventing old proofs

    // === State ===
    IGroth16Verifier public immutable verifier;

    /**
     * @dev Replay protection: proofHash (keccak256 of inputs) => verified status.
     *      Storage slot packing not applicable here as mapping is 32-byte key.
     */
    mapping(bytes32 => bool) public verifiedProofs;

    /**
     * @dev Maps Access Event Hash to block timestamp of audit.
     *      Useful for on-chain checks of "when was this accessed?".
     */
    mapping(bytes32 => uint64) public accessTimestamps;

    // === Events ===
    event AccessAudited(
        bytes32 indexed accessEventHash,
        bytes32 indexed proofHash,
        uint64 timestamp,
        address indexed auditor
    );

    // === Errors ===
    error ProofAlreadyUsed();
    error InvalidProof();
    error InvalidTimestamp(uint256 proofTime, uint256 blockTime);
    error ArrayLengthMismatch();

    /**
     * @param _verifier Address of the generated Groth16Verifier contract
     */
    constructor(address _verifier) {
        verifier = IGroth16Verifier(_verifier);
    }

    /**
     * @notice Verifies a ZK proof and records the audit log.
     * @param _pA Proof point A
     * @param _pB Proof point B
     * @param _pC Proof point C
     * @param _pubSignals Public signals [proofOfPolicyMatch, currentTimestamp, accessEventHash, ...]
     *        Note: Must match the Groth16Verifier signature (uint[4]).
     *        Index 0: proofOfPolicyMatch
     *        Index 1: currentTimestamp
     *        Index 2: accessEventHash
     *        Index 3: (Implicit/Extra signal if any, often unused or '1')
     */
    function verifyAndAudit(
        uint256[2] calldata _pA,
        uint256[2][2] calldata _pB,
        uint256[2] calldata _pC,
        uint256[4] calldata _pubSignals
    ) external {
        // 1. Compute Proof Hash for Replay Protection
        // We include pubSignals in the hash to ensure strictly unique combination
        bytes32 proofHash = keccak256(abi.encodePacked(_pA, _pB, _pC, _pubSignals));
        if (verifiedProofs[proofHash]) {
            revert ProofAlreadyUsed();
        }

        // 2. Validate Timestamp constraint (Prevent hoarding old proofs)
        // Public Signal [1] is 'currentTimestamp' from the circuit
        uint256 proofTimestamp = _pubSignals[1];
        if (
            proofTimestamp > block.timestamp + TIMESTAMP_THRESHOLD ||
            proofTimestamp < block.timestamp - TIMESTAMP_THRESHOLD
        ) {
            revert InvalidTimestamp(proofTimestamp, block.timestamp);
        }

        // 3. Verify Proof
        // Gas optimization: Inter-contract call overhead is verified.
        // If verifyProof returns false, it might just return false or revert depending on impl.
        // The generated verifier returns bool.
        if (!verifier.verifyProof(_pA, _pB, _pC, _pubSignals)) {
            revert InvalidProof();
        }

        // 4. Update State (Effects)
        verifiedProofs[proofHash] = true;
        
        // Public Signal [2] is 'accessEventHash' (The binding commitment)
        bytes32 accessEventHash = bytes32(_pubSignals[2]);
        accessTimestamps[accessEventHash] = uint64(block.timestamp);

        // 5. Emit Event
        emit AccessAudited(
            accessEventHash,
            proofHash,
            uint64(block.timestamp),
            msg.sender
        );
    }

    /**
     * @notice Batch verification for gas savings (if relayer submits multiple).
     */
    function batchVerifyAndAudit(
        uint256[2][] calldata _pAs,
        uint256[2][2][] calldata _pBs,
        uint256[2][] calldata _pCs,
        uint256[4][] calldata _pubSignals
    ) external {
        uint256 len = _pAs.length;
        if (
            len != _pBs.length ||
            len != _pCs.length ||
            len != _pubSignals.length
        ) {
            revert ArrayLengthMismatch();
        }

        for (uint256 i = 0; i < len; ) {
            // Batch verification is strict: any failure reverts the entire transaction.
            // This ensures atomic integrity for batched audit logs.
            this.verifyAndAudit(_pAs[i], _pBs[i], _pCs[i], _pubSignals[i]);
            unchecked { ++i; }
        }
    }
}
