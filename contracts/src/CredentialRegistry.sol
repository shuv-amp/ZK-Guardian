// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title CredentialRegistry
 * @notice On-chain registry for verified clinician credentials
 * @dev Stores Merkle root of all valid clinician credential hashes.
 *      The BreakGlass circuit verifies Merkle membership to ensure only
 *      licensed clinicians can invoke emergency access.
 *
 * Credential Hash = Poseidon(clinicianId[4], clinicianLicense[4], facilityId[0])
 * Same computation as BreakGlass.circom line 63-69
 */
contract CredentialRegistry is Initializable, AccessControlUpgradeable, UUPSUpgradeable {
    // === Roles ===
    bytes32 public constant REGISTRY_MANAGER_ROLE = keccak256("REGISTRY_MANAGER_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");

    // === State ===
    /// @notice Current Merkle root of all valid credential hashes
    bytes32 public credentialsMerkleRoot;

    /// @notice Mapping of individual credential hashes for O(1) lookup (optional, for non-ZK verification)
    mapping(bytes32 => bool) public isCredentialValid;

    /// @notice Number of registered credentials
    uint256 public credentialCount;

    /// @notice Emergency revocation - instantly invalidates a credential
    mapping(bytes32 => bool) public isRevoked;

    // === Events ===
    event CredentialAdded(bytes32 indexed credentialHash, address indexed addedBy, uint256 timestamp);
    event CredentialRevoked(bytes32 indexed credentialHash, address indexed revokedBy, string reason);
    event MerkleRootUpdated(bytes32 indexed oldRoot, bytes32 indexed newRoot, uint256 credentialCount);

    // === Errors ===
    error CredentialAlreadyExists();
    error CredentialNotFound();
    error CredentialIsRevoked();
    error InvalidMerkleRoot();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initialize the registry
     * @param admin Address to receive admin role
     */
    function initialize(address admin) public initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(REGISTRY_MANAGER_ROLE, admin);
        _grantRole(UPGRADER_ROLE, admin);

        // Initial empty Merkle root (no credentials)
        credentialsMerkleRoot = bytes32(0);
    }

    /**
     * @notice Add a single credential hash
     * @dev For quick additions. For batch operations, use updateMerkleRoot.
     * @param credentialHash Poseidon hash of clinician credentials
     */
    function addCredential(bytes32 credentialHash) external onlyRole(REGISTRY_MANAGER_ROLE) {
        if (isCredentialValid[credentialHash]) revert CredentialAlreadyExists();
        if (isRevoked[credentialHash]) revert CredentialIsRevoked();

        isCredentialValid[credentialHash] = true;
        credentialCount++;

        emit CredentialAdded(credentialHash, msg.sender, block.timestamp);
    }

    /**
     * @notice Revoke a credential (emergency action)
     * @param credentialHash Hash to revoke
     * @param reason Human-readable reason for audit trail
     */
    function revokeCredential(bytes32 credentialHash, string calldata reason) 
        external 
        onlyRole(REGISTRY_MANAGER_ROLE) 
    {
        if (!isCredentialValid[credentialHash]) revert CredentialNotFound();

        isCredentialValid[credentialHash] = false;
        isRevoked[credentialHash] = true;
        credentialCount--;

        emit CredentialRevoked(credentialHash, msg.sender, reason);
    }

    /**
     * @notice Update the Merkle root (batch operation)
     * @dev Called after recomputing the Merkle tree off-chain with all valid credentials
     * @param newRoot New Merkle root
     * @param newCount Total number of credentials in the tree
     */
    function updateMerkleRoot(bytes32 newRoot, uint256 newCount) 
        external 
        onlyRole(REGISTRY_MANAGER_ROLE) 
    {
        if (newRoot == bytes32(0) && newCount > 0) revert InvalidMerkleRoot();

        bytes32 oldRoot = credentialsMerkleRoot;
        credentialsMerkleRoot = newRoot;
        credentialCount = newCount;

        emit MerkleRootUpdated(oldRoot, newRoot, newCount);
    }

    /**
     * @notice Check if a credential is valid (non-ZK path)
     * @param credentialHash Hash to check
     * @return valid True if credential is registered and not revoked
     */
    function isValid(bytes32 credentialHash) external view returns (bool valid) {
        return isCredentialValid[credentialHash] && !isRevoked[credentialHash];
    }

    /**
     * @notice Get the current Merkle root for ZK circuit verification
     * @return root Current Merkle root
     */
    function getMerkleRoot() external view returns (bytes32 root) {
        return credentialsMerkleRoot;
    }

    /**
     * @notice Batch check credentials
     * @param hashes Array of credential hashes to check
     * @return results Array of validity statuses
     */
    function batchCheckCredentials(bytes32[] calldata hashes) 
        external 
        view 
        returns (bool[] memory results) 
    {
        results = new bool[](hashes.length);
        for (uint256 i = 0; i < hashes.length; ) {
            results[i] = isCredentialValid[hashes[i]] && !isRevoked[hashes[i]];
            unchecked { ++i; }
        }
    }

    // === UUPS Upgrade ===
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(UPGRADER_ROLE) {}
}
