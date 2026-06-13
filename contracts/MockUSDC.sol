// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @notice Minimal EIP-3009 USDC for the Atlantic settlement probe.
/// @dev Domain version is pinned to "2" to match the x402/evm ExactEvmScheme.
contract MockUSDC is ERC20, EIP712 {
    bytes32 public constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH =
        keccak256(
            "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
        );

    mapping(address => mapping(bytes32 => bool)) public authorizationState;

    constructor() ERC20("USD Coin", "USDC") EIP712("USD Coin", "2") {
        _mint(msg.sender, 1_000_000 * 10 ** 6); // 1M USDC to deployer (the agent)
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        require(block.timestamp > validAfter, "MockUSDC: auth not yet valid");
        require(block.timestamp < validBefore, "MockUSDC: auth expired");
        require(!authorizationState[from][nonce], "MockUSDC: auth already used");

        authorizationState[from][nonce] = true;

        bytes32 structHash = keccak256(
            abi.encode(
                TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
                from,
                to,
                value,
                validAfter,
                validBefore,
                nonce
            )
        );

        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(digest, v, r, s);
        require(signer == from, "MockUSDC: invalid signature");

        _transfer(from, to, value);
    }
}
