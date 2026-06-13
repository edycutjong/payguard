// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IERC20WithPermit {
    function receiveWithAuthorization(
        address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, bytes calldata signature
    ) external;
}

/// @title AgentVault — minimal conditional USDC escrow for the Pharos agent economy.
/// @notice Deliberately tiny + auditable (CertiK Skill Scanner target): no streaming,
///         no upgradeability, no delegatecall. SafeERC20 + ReentrancyGuard + strict CEI.
contract AgentVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;

    enum Status { None, Locked, Released, Refunded }

    struct Escrow {
        address payer;
        address payee;
        uint256 amount;
        bytes32 conditionHash; // keccak256(preimage) the payer must reveal to release
        uint64 deadline;       // unix seconds; after this, payer can be refunded
        Status status;
    }

    mapping(uint256 => Escrow) public escrows;
    uint256 public nextId;
    uint256 public totalLocked; // invariant: == usdc.balanceOf(this) for a sole-purpose vault

    event Locked(uint256 indexed id, address indexed payer, address indexed payee, uint256 amount, bytes32 conditionHash, uint64 deadline);
    event Released(uint256 indexed id, address indexed payee, uint256 amount);
    event Refunded(uint256 indexed id, address indexed payer, uint256 amount);

    error ZeroAmount();
    error BadDeadline();
    error NotPayer();
    error WrongStatus();
    error BadPreimage();
    error NotExpired();
    error Expired();

    constructor(address _usdc) {
        usdc = IERC20(_usdc);
    }

    /// @notice Lock `amount` USDC releasable to `payee` upon revealing the condition preimage.
    function lock(address payee, uint256 amount, bytes32 conditionHash, uint64 deadline)
        external
        nonReentrant
        returns (uint256 id)
    {
        if (amount == 0) revert ZeroAmount();
        if (deadline <= block.timestamp) revert BadDeadline();

        id = nextId++;
        escrows[id] = Escrow({
            payer: msg.sender,
            payee: payee,
            amount: amount,
            conditionHash: conditionHash,
            deadline: deadline,
            status: Status.Locked
        });
        totalLocked += amount;

        emit Locked(id, msg.sender, payee, amount, conditionHash, deadline);
        usdc.safeTransferFrom(msg.sender, address(this), amount); // pull funds last
    }

    /// @notice Payer releases to payee by revealing the preimage, before the deadline.
    function release(uint256 id, bytes calldata preimage) external nonReentrant {
        Escrow storage e = escrows[id];
        if (e.status != Status.Locked) revert WrongStatus();
        if (msg.sender != e.payer) revert NotPayer();
        if (block.timestamp > e.deadline) revert Expired();
        if (keccak256(preimage) != e.conditionHash) revert BadPreimage();

        e.status = Status.Released;              // effects
        totalLocked -= e.amount;
        uint256 amount = e.amount;
        address payee = e.payee;

        emit Released(id, payee, amount);
        usdc.safeTransfer(payee, amount);        // interaction
    }

    /// @notice After the deadline, anyone may trigger a refund of the locked funds to the payer.
    function refund(uint256 id) external nonReentrant {
        Escrow storage e = escrows[id];
        if (e.status != Status.Locked) revert WrongStatus();
        if (block.timestamp <= e.deadline) revert NotExpired();

        e.status = Status.Refunded;              // effects
        totalLocked -= e.amount;
        uint256 amount = e.amount;
        address payer = e.payer;

        emit Refunded(id, payer, amount);
        usdc.safeTransfer(payer, amount);        // interaction
    }

    // Track EIP-3009 nonces to prevent replay attacks
    mapping(bytes32 => bool) public executedNonces;

    error NonceAlreadyConsumed(bytes32 nonce);

    function executeGuardianPayment(
        address payee,
        uint256 amount,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature
    ) external nonReentrant {
        // 1. CHECKS
        if (executedNonces[nonce]) revert NonceAlreadyConsumed(nonce);
        // (Assume signature verification logic here)

        // 2. EFFECTS (State mutations MUST occur before external interactions)
        executedNonces[nonce] = true;

        // 3. INTERACTIONS
        IERC20WithPermit(address(usdc)).receiveWithAuthorization(
            payee, address(this), amount, validAfter, validBefore, nonce, signature
        );
    }
}
