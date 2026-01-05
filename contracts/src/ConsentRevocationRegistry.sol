// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title ConsentRevocationRegistry
 * @notice Central on-chain registry for revoked FHIR consents.
 * @dev Allows authorized entities (Gateway, or future Patient Wallets) to signal revocation.
 *      Decoupled from Audit log to preserve ZK privacy while enabling accountability.
 */
contract ConsentRevocationRegistry is AccessControl {
    // === Roles ===
    bytes32 public constant REVOKER_ROLE = keccak256("REVOKER_ROLE");

    // === State ===
    // Maps Consent Policy Hash -> Is Revoked
    mapping(bytes32 => bool) public isRevoked;

    // === Events ===
    event ConsentRevoked(
        bytes32 indexed consentHash,
        address indexed revoker,
        string reason,
        uint256 timestamp
    );

    event ConsentRestored(
        bytes32 indexed consentHash,
        address indexed restorer,
        uint256 timestamp
    );

    // === Errors ===
    error ConsentAlreadyRevoked();
    error ConsentNotRevoked();

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(REVOKER_ROLE, msg.sender);
    }

    /**
     * @notice Revokes a specific consent policy hash.
     * @dev Once revoked, off-chain auditors know proofs using this policy are invalid.
     * @param consentHash The Poseidon hash of the FHIR Consent resource.
     * @param reason Human-readable reason for revocation (e.g. "Patient Request").
     */
    function revokeConsent(bytes32 consentHash, string calldata reason) 
        external 
        onlyRole(REVOKER_ROLE) 
    {
        if (isRevoked[consentHash]) revert ConsentAlreadyRevoked();

        isRevoked[consentHash] = true;

        emit ConsentRevoked(
            consentHash,
            msg.sender,
            reason,
            block.timestamp
        );
    }

    /**
     * @notice Restores a consent (e.g. if revoked in error).
     * @param consentHash The Poseidon hash to restore.
     */
    function restoreConsent(bytes32 consentHash) 
        external 
        onlyRole(REVOKER_ROLE) 
    {
        if (!isRevoked[consentHash]) revert ConsentNotRevoked();

        isRevoked[consentHash] = false;

        emit ConsentRestored(
            consentHash,
            msg.sender,
            block.timestamp
        );
    }

    /**
     * @notice Checks if a set of consents are revoked.
     * @param consentHashes Array of hashes to check.
     * @return statuses Array of bools (true = revoked).
     */
    function checkRevocationStatus(bytes32[] calldata consentHashes) 
        external 
        view 
        returns (bool[] memory statuses) 
    {
        statuses = new bool[](consentHashes.length);
        for (uint256 i = 0; i < consentHashes.length; ) {
            statuses[i] = isRevoked[consentHashes[i]];
            unchecked { ++i; }
        }
    }
}
