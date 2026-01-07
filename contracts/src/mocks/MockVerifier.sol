// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

contract MockVerifier {
    bool private shouldPass;

    constructor() {
        shouldPass = true;
    }

    function setShouldPass(bool _shouldPass) external {
        shouldPass = _shouldPass;
    }

    function verifyProof(
        uint256[2] calldata _pA,
        uint256[2][2] calldata _pB,
        uint256[2] calldata _pC,
        uint256[7] calldata _pubSignals
    ) external view returns (bool) {
        return shouldPass;
    }
}
