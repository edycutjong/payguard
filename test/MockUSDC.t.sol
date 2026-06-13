// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../contracts/MockUSDC.sol";

/// Offline, deterministic proof of the EIP-3009 `transferWithAuthorization` path
/// (the same primitive the on-chain `probe`/`demo` settle through).
contract MockUSDCTest is Test {
    MockUSDC usdc;
    uint256 fromPk = 0xA11CE;
    address from;
    address to = address(0xBEEF);

    bytes32 constant TYPEHASH = keccak256(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    function setUp() public {
        from = vm.addr(fromPk);
        usdc = new MockUSDC(); // mints 1,000,000 USDC to this test contract
        usdc.transfer(from, 10_000e6); // fund the payer
    }

    function _domainSeparator() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("USD Coin")),
                keccak256(bytes("2")),
                block.chainid,
                address(usdc)
            )
        );
    }

    function _digest(uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce)
        internal
        view
        returns (bytes32)
    {
        bytes32 structHash = keccak256(abi.encode(TYPEHASH, from, to, value, validAfter, validBefore, nonce));
        return keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), structHash));
    }

    function test_DecimalsAndMint() public view {
        assertEq(usdc.decimals(), 6);
        assertEq(usdc.balanceOf(from), 10_000e6);
    }

    function test_TransferWithAuthorization() public {
        uint256 validBefore = block.timestamp + 1 hours;
        bytes32 nonce = keccak256("n1");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(fromPk, _digest(1000, 0, validBefore, nonce));

        usdc.transferWithAuthorization(from, to, 1000, 0, validBefore, nonce, v, r, s);

        assertEq(usdc.balanceOf(to), 1000);
        assertTrue(usdc.authorizationState(from, nonce));
    }

    function test_RevertWhen_NotYetValid() public {
        uint256 validAfter = block.timestamp + 1 hours;
        uint256 validBefore = block.timestamp + 2 hours;
        bytes32 nonce = keccak256("n2");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(fromPk, _digest(1000, validAfter, validBefore, nonce));

        vm.expectRevert("MockUSDC: auth not yet valid");
        usdc.transferWithAuthorization(from, to, 1000, validAfter, validBefore, nonce, v, r, s);
    }

    function test_RevertWhen_Expired() public {
        vm.warp(100_000);
        uint256 validBefore = block.timestamp - 1; // already past
        bytes32 nonce = keccak256("n3");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(fromPk, _digest(1000, 0, validBefore, nonce));

        vm.expectRevert("MockUSDC: auth expired");
        usdc.transferWithAuthorization(from, to, 1000, 0, validBefore, nonce, v, r, s);
    }

    function test_RevertWhen_ReplayedNonce() public {
        uint256 validBefore = block.timestamp + 1 hours;
        bytes32 nonce = keccak256("n4");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(fromPk, _digest(1000, 0, validBefore, nonce));

        usdc.transferWithAuthorization(from, to, 1000, 0, validBefore, nonce, v, r, s);

        vm.expectRevert("MockUSDC: auth already used");
        usdc.transferWithAuthorization(from, to, 1000, 0, validBefore, nonce, v, r, s);
    }

    function test_RevertWhen_InvalidSignature() public {
        uint256 validBefore = block.timestamp + 1 hours;
        bytes32 nonce = keccak256("n5");
        // signed by a key that is NOT `from`
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xB0B, _digest(1000, 0, validBefore, nonce));

        vm.expectRevert("MockUSDC: invalid signature");
        usdc.transferWithAuthorization(from, to, 1000, 0, validBefore, nonce, v, r, s);
    }
}
