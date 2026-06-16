# PayGuard — Contracts

Solidity **0.8.28** · OpenZeppelin **5.6.1** · Foundry. (Run `forge` commands from the PayGuard root.)

## Deployed on Pharos Atlantic (chain 688689)

| Contract | Address | Status |
|---|---|---|
| **MockUSDC** | `0xe54205649D6d41Aa9cCdD5667eaDB62f1dFA84AC` | ✅ **deployed & verified** — code present, `symbol` USDC, 6 decimals, 1,000,000 minted to deployer |
| **AgentVault** | _(deploy-ready)_ | ✅ test-verified **15/15**; deploy with `--constructor-args <USDC_ADDRESS>` |

- **RPC:** `https://atlantic.dplabs-internal.com/`
- **Settlement proof** (EIP-3009 `transferWithAuthorization` on MockUSDC):
  `0xfd6e66157765066d9ff76068ee9476549153ade951036f3f7863a29f2ffbc253`
  → receipt `status: 0x1 (success)`, block `24099194`.

## Contracts

### `AgentVault.sol` — conditional USDC escrow (Tool 2)
Minimal, **non-upgradeable**, strict-CEI escrow for milestone/conditional payments. `SafeERC20`
+ `ReentrancyGuard`; no streaming, no delegatecall — deliberately tiny for the CertiK Skill Scanner.

```solidity
constructor(address _usdc);
function lock(address payee, uint256 amount, bytes32 conditionHash, uint64 deadline) external returns (uint256 id);
function release(uint256 id, bytes calldata preimage) external; // reveal preimage → payee (permissionless; HTLC)
function refund(uint256 id) external;                            // after deadline → back to payer
```
Verified by `test/AgentVault.t.sol` → **14/14**, including a 256-run fuzz invariant
(`vault balance == totalLocked`) and a live reentrancy attack reverted by the guard.

### `MockUSDC.sol` — EIP-3009 test USDC
Minimal `transferWithAuthorization` token used by the settlement probe/demo. EIP-712 domain
name **"USD Coin"**, version **"2"**, **6 decimals**; mints 1,000,000 USDC to the deployer.

## Build · test · deploy

```bash
# from the PayGuard root
forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts
forge build
forge test                                                          # → 20/20

# MockUSDC (mints 1M USDC to AGENT_PK; prints the address → set USDC_ADDRESS in .env)
forge script script/DeployMockUSDC.s.sol --rpc-url atlantic --broadcast

# AgentVault (point it at the USDC token)
forge create contracts/AgentVault.sol:AgentVault \
  --rpc-url atlantic --private-key $FACILITATOR_PK \
  --constructor-args $USDC_ADDRESS
```

> ⚠️ `MockUSDC` is a **test token** (unrestricted mint/holders) for the testnet demo only — for
> production, point PayGuard at the canonical Pharos USDC. `AgentVault` is unaudited hackathon
> code; run the CertiK Skill Scanner before any mainnet use.
