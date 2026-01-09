// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";

/**
 * @title ZKGuardianToken
 * @notice Governance token for ZK Guardian DAO
 * @dev ERC20 with vote delegation (ERC20Votes) for Governor compatibility.
 * 
 * Features:
 * - Fixed supply minted to deployer (for initial distribution)
 * - Vote delegation (users must delegate to themselves or others to vote)
 * - EIP-2612 permit for gasless approvals
 * 
 * Initial Distribution Plan:
 * - 40% DAO Treasury (controlled by Timelock)
 * - 30% Team (4-year vesting)
 * - 20% Community rewards
 * - 10% Advisors/Partners
 */
contract ZKGuardianToken is ERC20, ERC20Permit, ERC20Votes {
    /// @notice Total supply: 100 million tokens with 18 decimals
    uint256 public constant INITIAL_SUPPLY = 100_000_000 * 10**18;

    constructor(address initialHolder)
        ERC20("ZK Guardian", "ZKG")
        ERC20Permit("ZK Guardian")
    {
        _mint(initialHolder, INITIAL_SUPPLY);
    }

    // === Required Overrides ===

    function _update(address from, address to, uint256 amount)
        internal
        override(ERC20, ERC20Votes)
    {
        super._update(from, to, amount);
    }

    function nonces(address owner)
        public
        view
        override(ERC20Permit, Nonces)
        returns (uint256)
    {
        return super.nonces(owner);
    }
}
