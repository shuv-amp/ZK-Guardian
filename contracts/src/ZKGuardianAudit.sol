// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";

interface IGroth16Verifier {
    function verifyProof(
        uint256[2] calldata _pA,
        uint256[2][2] calldata _pB,
        uint256[2] calldata _pC,
        uint256[7] calldata _pubSignals
    ) external view returns (bool);
}

interface IBreakGlassVerifier {
    function verifyProof(
        uint256[2] calldata _pA,
        uint256[2][2] calldata _pB,
        uint256[2] calldata _pC,
        uint256[9] calldata _pubSignals // V2: Added credentialsMerkleRoot
    ) external view returns (bool);
}

interface ICredentialRegistry {
    function getMerkleRoot() external view returns (bytes32);
    function isValid(bytes32 credentialHash) external view returns (bool);
}

/**
 * @title ZKGuardianAudit
 * @notice Gas-optimized audit log for ZK-protected healthcare access.
 * @dev Verifies Groth16 proofs and logs access events on-chain.
 *      Implements strict replay protection and timestamp validation.
 *      UPGRADEABLE: UUPS Pattern
 */
contract ZKGuardianAudit is Initializable, UUPSUpgradeable, AccessControlUpgradeable {
    // === Constants ===
    uint256 private constant TIMESTAMP_THRESHOLD = 5 minutes;
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");

    // === State ===
    IGroth16Verifier public verifier; // Removed immutable for upgradeability
    // Storage gap rule: Append new variables at the end or use gap
    mapping(bytes32 => bool) public verifiedProofs;
    mapping(uint256 => bool) public usedNullifiers;
    mapping(bytes32 => uint64) public accessTimestamps;

    // V2 New State Variables (Appended for Upgrade Safety)
    IBreakGlassVerifier public breakGlassVerifier; 
    ICredentialRegistry public credentialRegistry;

    // === Events ===
    event AccessAudited(
        bytes32 indexed accessEventHash,
        bytes32 indexed proofHash,
        uint256 blindedPatientId,
        uint256 blindedAccessHash,
        uint64 timestamp,
        address indexed auditor
    );

    event EmergencyAccessAudited(
        bytes32 indexed emergencyAccessHash,
        bytes32 indexed proofHash,
        uint256 blindedClinicianId,
        uint256 blindedPatientId,
        uint256 emergencyCode,
        uint256 justificationCommitment,
        uint64 timestamp,
        address indexed auditor
    );

    // === Errors ===
    error ProofAlreadyUsed();
    error NullifierAlreadyUsed();
    error InvalidProof();
    error InvalidTimestamp(uint256 proofTime, uint256 blockTime);
    error ArrayLengthMismatch();
    error EmergencyThresholdNotMet(uint256 provided, uint256 required);
    error BreakGlassVerifierNotSet();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initialize the contract (replaces constructor)
     * @param _verifier Address of the Groth16Verifier
     * @param _admin Address of the initial admin and upgrader
     */
    function initialize(address _verifier, address _admin) public initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();

        verifier = IGroth16Verifier(_verifier);
        
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(UPGRADER_ROLE, _admin);
    }

    /**
     * @dev Authorize implementation upgrades.
     *      Restricted to UPGRADER_ROLE.
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(UPGRADER_ROLE) {}

    /**
     * @notice Verifies a ZK proof and records the audit log.
     */
    function verifyAndAudit(
        uint256[2] calldata _pA,
        uint256[2][2] calldata _pB,
        uint256[2] calldata _pC,
        uint256[7] calldata _pubSignals
    ) external {
        _verifyAndAudit(_pA, _pB, _pC, _pubSignals, msg.sender);
    }

    function _verifyAndAudit(
        uint256[2] memory _pA,
        uint256[2][2] memory _pB,
        uint256[2] memory _pC,
        uint256[7] memory _pubSignals,
        address auditor
    ) internal {
        // 1. Compute Proof Hash
        bytes32 proofHash = keccak256(abi.encodePacked(_pA, _pB, _pC, _pubSignals));
        if (verifiedProofs[proofHash]) {
            revert ProofAlreadyUsed();
        }

        // 2. Validate Public Signals
        if (_pubSignals[0] != 1) revert InvalidProof();

        uint256 proofTimestamp = _pubSignals[5];
        if (
            proofTimestamp > block.timestamp + TIMESTAMP_THRESHOLD ||
            proofTimestamp < block.timestamp - TIMESTAMP_THRESHOLD
        ) {
            revert InvalidTimestamp(proofTimestamp, block.timestamp);
        }

        uint256 nullifierHash = _pubSignals[3];
        if (usedNullifiers[nullifierHash]) revert NullifierAlreadyUsed();

        // 3. Verify Proof
        if (!verifier.verifyProof(_pA, _pB, _pC, _pubSignals)) {
            revert InvalidProof();
        }

        // 4. Update State
        verifiedProofs[proofHash] = true;
        bytes32 accessEventHash = bytes32(_pubSignals[6]);
        accessTimestamps[accessEventHash] = uint64(block.timestamp);
        usedNullifiers[nullifierHash] = true;

        // 5. Emit Event
        emit AccessAudited(
            accessEventHash,
            proofHash,
            _pubSignals[1], // blindedPatientId
            _pubSignals[2], // blindedAccessHash
            uint64(block.timestamp),
            auditor
        );
    }

    /**
     * @notice Batch verification
     */
    function batchVerifyAndAudit(
        uint256[2][] calldata _pAs,
        uint256[2][2][] calldata _pBs,
        uint256[2][] calldata _pCs,
        uint256[7][] calldata _pubSignals
    ) external {
        uint256 len = _pAs.length;
        if (len != _pBs.length || len != _pCs.length || len != _pubSignals.length) {
            revert ArrayLengthMismatch();
        }

        for (uint256 i = 0; i < len; ) {
            _verifyAndAudit(_pAs[i], _pBs[i], _pCs[i], _pubSignals[i], msg.sender);
            unchecked { ++i; }
        }
    }

    // ============================================
    // BREAK-GLASS (EMERGENCY ACCESS) FUNCTIONS
    // ============================================

    /**
     * @notice Sets the BreakGlass verifier address (Admin only)
     * @param _breakGlassVerifier Address of the deployed BreakGlassVerifier
     */
    function setBreakGlassVerifier(address _breakGlassVerifier) external onlyRole(DEFAULT_ADMIN_ROLE) {
        breakGlassVerifier = IBreakGlassVerifier(_breakGlassVerifier);
    }

    /**
     * @notice Sets the Credential Registry address (Admin only)
     * @param _credentialRegistry Address of the deployed CredentialRegistry
     */
    function setCredentialRegistry(address _credentialRegistry) external onlyRole(DEFAULT_ADMIN_ROLE) {
        credentialRegistry = ICredentialRegistry(_credentialRegistry);
    }

    /**
     * @notice Verify a Break-Glass (Emergency Access) proof and log the audit.
     * @dev BreakGlass V2 circuit has 9 public signals:
     *      [0] isValid (must be 1)
     *      [1] blindedClinicianId
     *      [2] blindedPatientId
     *      [3] emergencyAccessHash (unique per event)
     *      [4] justificationCommitment
     *      [5] currentTimestamp (public input)
     *      [6] accessEventHash (public input)
     *      [7] emergencyThreshold (public input)
     *      [8] credentialsMerkleRoot (public input, verified against on-chain registry)
     * @param _pA Proof element A
     * @param _pB Proof element B
     * @param _pC Proof element C
     * @param _pubSignals 9-element public signals array
     * @param requiredThreshold Minimum emergency level (1-4)
     */
    function verifyBreakGlassAndAudit(
        uint256[2] calldata _pA,
        uint256[2][2] calldata _pB,
        uint256[2] calldata _pC,
        uint256[9] calldata _pubSignals,
        uint256 requiredThreshold
    ) external {
        // 0. Pre-checks
        if (address(breakGlassVerifier) == address(0)) {
            revert BreakGlassVerifierNotSet();
        }

        // 1. Compute Proof Hash
        bytes32 proofHash = keccak256(abi.encodePacked(_pA, _pB, _pC, _pubSignals));
        if (verifiedProofs[proofHash]) {
            revert ProofAlreadyUsed();
        }

        // 2. Validate Public Signals
        // Signal 0 = isValid (must be 1)
        if (_pubSignals[0] != 1) revert InvalidProof();

        // Signal 7 = emergencyThreshold from proof must meet our required threshold
        uint256 proofThreshold = _pubSignals[7];
        if (proofThreshold < requiredThreshold) {
            revert EmergencyThresholdNotMet(proofThreshold, requiredThreshold);
        }

        // Signal 8 = credentialsMerkleRoot - verify against on-chain registry
        if (address(credentialRegistry) != address(0)) {
            bytes32 onChainRoot = credentialRegistry.getMerkleRoot();
            bytes32 proofRoot = bytes32(_pubSignals[8]);
            if (onChainRoot != proofRoot) {
                revert InvalidProof(); // Merkle root mismatch
            }
        }

        // Signal 5 = currentTimestamp
        uint256 proofTimestamp = _pubSignals[5];
        if (
            proofTimestamp > block.timestamp + TIMESTAMP_THRESHOLD ||
            proofTimestamp < block.timestamp - TIMESTAMP_THRESHOLD
        ) {
            revert InvalidTimestamp(proofTimestamp, block.timestamp);
        }

        // Signal 3 = emergencyAccessHash (used as nullifier for replay protection)
        uint256 emergencyNullifier = _pubSignals[3];
        if (usedNullifiers[emergencyNullifier]) revert NullifierAlreadyUsed();

        // 3. Verify Proof
        if (!breakGlassVerifier.verifyProof(_pA, _pB, _pC, _pubSignals)) {
            revert InvalidProof();
        }

        // 4. Update State
        verifiedProofs[proofHash] = true;
        usedNullifiers[emergencyNullifier] = true;
        bytes32 accessEventHash = bytes32(_pubSignals[6]);
        accessTimestamps[accessEventHash] = uint64(block.timestamp);

        // 5. Emit Event
        emit EmergencyAccessAudited(
            bytes32(emergencyNullifier), // emergencyAccessHash
            proofHash,
            _pubSignals[1], // blindedClinicianId
            _pubSignals[2], // blindedPatientId
            proofThreshold, // emergencyCode
            _pubSignals[4], // justificationCommitment
            uint64(block.timestamp),
            msg.sender
        );
    }
}
