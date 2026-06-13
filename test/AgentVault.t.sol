// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AgentVault} from "../contracts/AgentVault.sol";

contract AgentVaultTest is Test {
    AgentVault vault;
    MintableERC20 usdc;

    address payer = address(this);
    address payee = makeAddr("payee");
    bytes preimage = bytes("milestone-1-delivered");
    bytes32 condition = keccak256(bytes("milestone-1-delivered"));
    uint64 deadline;

    function setUp() public {
        usdc = new MintableERC20();
        vault = new AgentVault(address(usdc));
        usdc.mint(payer, 1_000_000e6);
        usdc.approve(address(vault), type(uint256).max);
        deadline = uint64(block.timestamp + 1 days);
    }

    function _lock(uint256 amount) internal returns (uint256 id) {
        id = vault.lock(payee, amount, condition, deadline);
    }

    // ---- happy path ----
    function test_LockThenRelease() public {
        uint256 id = _lock(100e6);
        assertEq(usdc.balanceOf(address(vault)), 100e6);
        assertEq(vault.totalLocked(), 100e6);

        vault.release(id, preimage);
        assertEq(usdc.balanceOf(payee), 100e6);
        assertEq(vault.totalLocked(), 0);
        (, , , , , AgentVault.Status status) = vault.escrows(id);
        assertEq(uint8(status), uint8(AgentVault.Status.Released));
    }

    function test_RefundAfterDeadline() public {
        uint256 id = _lock(250e6);
        vm.warp(deadline + 1);
        vault.refund(id);
        assertEq(usdc.balanceOf(payer), 1_000_000e6); // fully returned
        assertEq(vault.totalLocked(), 0);
    }

    // ---- access control & state machine ----
    function test_RevertWhen_WrongPreimage() public {
        uint256 id = _lock(100e6);
        vm.expectRevert(AgentVault.BadPreimage.selector);
        vault.release(id, bytes("wrong-secret"));
    }

    function test_RevertWhen_ReleaseByNonPayer() public {
        uint256 id = _lock(100e6);
        vm.prank(makeAddr("intruder"));
        vm.expectRevert(AgentVault.NotPayer.selector);
        vault.release(id, preimage);
    }

    function test_RevertWhen_ReleaseAfterDeadline() public {
        uint256 id = _lock(100e6);
        vm.warp(deadline + 1);
        vm.expectRevert(AgentVault.Expired.selector);
        vault.release(id, preimage);
    }

    function test_RevertWhen_RefundBeforeDeadline() public {
        uint256 id = _lock(100e6);
        vm.expectRevert(AgentVault.NotExpired.selector);
        vault.refund(id);
    }

    function test_RevertWhen_DoubleRelease() public {
        uint256 id = _lock(100e6);
        vault.release(id, preimage);
        vm.expectRevert(AgentVault.WrongStatus.selector);
        vault.release(id, preimage);
    }

    function test_RevertWhen_RefundOnReleased() public {
        uint256 id = _lock(100e6);
        vault.release(id, preimage);
        vm.expectRevert(AgentVault.WrongStatus.selector);
        vault.refund(id);
    }

    function test_RevertWhen_ZeroAmount() public {
        vm.expectRevert(AgentVault.ZeroAmount.selector);
        vault.lock(payee, 0, condition, deadline);
    }

    function test_RevertWhen_PastDeadline() public {
        vm.expectRevert(AgentVault.BadDeadline.selector);
        vault.lock(payee, 100e6, condition, uint64(block.timestamp));
    }

    // ---- invariant under fuzzing: vault balance always equals totalLocked ----
    function testFuzz_BalanceMatchesTotalLocked(uint256 amount) public {
        amount = bound(amount, 1, 1_000_000e6);
        uint256 id = _lock(amount);
        assertEq(usdc.balanceOf(address(vault)), vault.totalLocked());
        assertEq(vault.totalLocked(), amount);
        vault.release(id, preimage);
        assertEq(usdc.balanceOf(address(vault)), 0);
        assertEq(vault.totalLocked(), 0);
    }

    // ---- reentrancy: a malicious token that re-enters release() must be stopped ----
    function test_ReentrancyGuardBlocksReentry() public {
        ReentrantToken atk = new ReentrantToken();
        AgentVault v2 = new AgentVault(address(atk));
        atk.mint(payer, 1_000e6);
        atk.approve(address(v2), type(uint256).max);
        uint256 id = v2.lock(payee, 100e6, condition, deadline);

        atk.arm(v2, id, preimage); // on next transfer, re-enter v2.release(id,...)
        vm.expectRevert(); // ReentrancyGuard: reentrant call reverts the whole release
        v2.release(id, preimage);
    }
}

contract MintableERC20 is ERC20 {
    constructor() ERC20("Mock USD Coin", "mUSDC") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function decimals() public pure override returns (uint8) { return 6; }
}

/// Re-enters AgentVault.release() on its outbound transfer — must be blocked by ReentrancyGuard.
contract ReentrantToken is ERC20 {
    AgentVault public target;
    uint256 public armedId;
    bytes public armedPreimage;
    bool public armed;

    constructor() ERC20("Reentrant", "RTK") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }

    function arm(AgentVault t, uint256 id, bytes calldata pre) external {
        target = t; armedId = id; armedPreimage = pre; armed = true;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        if (armed) {
            armed = false;
            target.release(armedId, armedPreimage); // reentrant attempt — guard reverts
        }
        return super.transfer(to, amount);
    }
}
