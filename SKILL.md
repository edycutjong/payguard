---
name: payguard
description: Safe x402 payments + conditional escrow for Pharos agents — the safety layer x402 lacks. Enforces deterministic spend caps, asset-spoof protection, eth_call pre-flight simulation, and milestone escrow before an agent signs an EIP-3009 authorization. Use when an autonomous agent pays for APIs/services via x402 on Pharos and must not overspend, pay a spoofed token, or pay for undelivered work. Triggers on "safe x402", "agent spend cap", "x402 guardrail", "pharos escrow", "conditional pay pharos", "guard my budget".
license: MIT
metadata:
  author: Edy Cu
  version: "1.0.0"
  chain_id: 688689
---

# PayGuard — Agentic Payment Security & Escrow for Pharos

**x402 enables autonomous AI commerce on Pharos — but without spending limits, one LLM
hallucination or one rogue endpoint can drain an agent's wallet in seconds.** x402 will sign
and settle *whatever* a server's `402 PAYMENT-REQUIRED` demands: no spend caps, no simulation,
no asset checks, no escrow. **PayGuard is the CertiK-grade seatbelt for Pharos's flagship
protocol** — two composable, atomic tools any agent imports to make x402 spending safe.

```text
  🛡️  PayGuard · GuardianRail — Attack → Blocked
┌─────────┬─────────────────────────────────┬─────────────────┬─────────────────────┐
│ (index) │ Attack Vector                   │ Result          │ Guard Code          │
├─────────┼─────────────────────────────────┼─────────────────┼─────────────────────┤
│ 0       │ 1. The Drainer (10,000 USDC)    │ 🛑 BLOCKED      │ MAX_SPEND           │
│ 1       │ 2. The Phish (0xFakeToken)      │ 🛑 BLOCKED      │ INVALID_ASSET       │
│ 2       │ 3. The Rogue Node (bad payTo)   │ 🛑 BLOCKED      │ UNAPPROVED_PAYEE    │
│ 3       │ 4. The Revert (sim fails)       │ 🛑 BLOCKED      │ SIMULATION_FAILED   │
│ 4       │ 5. The Inflator (negative amt)  │ 🛑 BLOCKED      │ MAX_SPEND           │
│ 5       │ 6. The Malformed (float amt)    │ 🛑 BLOCKED      │ INVALID_ASSET       │
│ 6       │ 7. The Clean Run                │ ✅ AUTHORIZED   │ AUTHORIZED          │
└─────────┴─────────────────────────────────┴─────────────────┴─────────────────────┘
  ✅ TOC/TOU pin — 2-entry offer collapsed to the single validated requirement
  ✅ 8/8 vectors handled correctly — 100% of unauthorized agent spends blocked.
```

## Pharos Network

- **Chain ID**: `688689` · **CAIP-2**: `eip155:688689`
- **RPC**: `https://atlantic.dplabs-internal.com/`
- **Asset**: USDC (6 decimals, EIP-3009 `transferWithAuthorization`, EIP-712 domain version `"2"`)
- Built on the official **x402** rail (`@x402/*` v2). PayGuard adds the controls x402 omits.

## When to Use

- An agent pays for APIs/data/compute via x402 and needs a hard **budget** it cannot exceed.
- You must guarantee the agent only ever pays the **canonical USDC**, never a look-alike token.
- You want a **dry-run** (`eth_call`) of every payment so reverts surface before signing.
- Two parties need **conditional/milestone escrow** (release on proof, refund on timeout).

---

## Tool 1 — GuardianRail (spend safety)

A client-side interceptor that enforces a deterministic policy on the `402` offer **before**
the x402 client signs the EIP-3009 authorization. Drop it under the x402 client:

```ts
import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { toClientEvmSigner } from "@x402/evm";
import { ExactEvmScheme } from "@x402/evm/exact/client"; // client role: createPaymentPayload
import { createGuardedFetch } from "./guardrail";

const account = privateKeyToAccount(process.env.AGENT_PK as `0x${string}`);
const pub = createPublicClient({ chain: pharosAtlantic, transport: http(process.env.RPC_URL) });

const policy = {
  agentAddress: account.address,       // from-address for simulation
  maxSpendPerCall: 5_000_000n,         // 5 USDC (6dp)
  dailyBudgetRemaining: 50_000_000n,   // 50 USDC/day, decremented per authorized spend
  targetAsset: "0xUSDC...",            // canonical USDC — strict-equality (anti-spoof)
  allowedPayees: ["0xKnownServer..."], // optional whitelist
  enforceSimulation: true,
};

const client = new x402Client();
client.register("eip155:688689", new ExactEvmScheme(toClientEvmSigner(account, pub)));

// GuardianRail nests UNDER the x402 client:
const guarded = createGuardedFetch(fetch, policy, { rpcUrl: process.env.RPC_URL });
const safeFetch = wrapFetchWithPayment(guarded, client);

// Throws AgentSecurityError({ code, reason }) instead of paying when a check fails.
const res = await safeFetch("https://api.example/paid");
```

**`GuardPolicy`**

| Field | Type | Enforced check |
|---|---|---|
| `agentAddress` | `Address` | from-address for the `eth_call` simulation |
| `maxSpendPerCall` | `bigint` | reject `amount > maxSpendPerCall` → `MAX_SPEND` |
| `dailyBudgetRemaining` | `bigint` | reject `amount > remaining` → `BUDGET_EXCEEDED`; decremented on authorize |
| `targetAsset` | `Address` | reject `asset !== targetAsset` → `INVALID_ASSET` |
| `allowedPayees?` | `Address[]` | reject `payTo ∉ list` → `UNAPPROVED_PAYEE` |
| `enforceSimulation?` | `boolean` | `eth_call` the transfer; revert → `SIMULATION_FAILED` |

All-clear → `AUTHORIZED` and the x402 client signs + settles. The policy core
(`evaluateRequirement`) is pure and synchronous — see `bench/malicious_bench.ts`.

## Tool 2 — AgentVault (conditional escrow)

A minimal USDC escrow for milestone/conditional payments — deliberately tiny and auditable
(no streaming, no upgradeability, no delegatecall; `SafeERC20` + `ReentrancyGuard` + strict CEI).

```solidity
function lock(address payee, uint256 amount, bytes32 conditionHash, uint64 deadline)
    external returns (uint256 id);          // pull USDC, hold until released/refunded
function release(uint256 id, bytes calldata preimage) external; // reveal preimage → payee (permissionless; HTLC)
function refund(uint256 id) external;        // after deadline → back to payer
```

```ts
// Agent flow: lock for a task, release when the deliverable proof is revealed.
const id = await vault.write.lock([payee, 100_000_000n, keccak256(proof), deadline]);
// ...work happens, proof verified...
await vault.write.release([id, proof]);      // or vault.refund(id) after the deadline
```

---

## Reuse & compose (the crucial Phase-1 criterion)

GuardianRail is a **pure, dependency-light module** with one public API (`src/index.ts`) and
**three** ways to compose it into any Pharos agent — pick the seam that fits:

| Way | One-liner | For |
|---|---|---|
| **Under the x402 client** | `wrapFetchWithPayment(createGuardedFetch(fetch, policy, { rpcUrl }), client)` | any `@x402/fetch` agent — gates the 402 before signing |
| **As an MCP tool** | `npm run mcp` → `evaluate_payment` | Claude Desktop / Cursor / any MCP runtime — zero PayGuard code |
| **As a pure function** | `evaluateRequirement(req, policy, sim)` | your own loop / tests — sync, offline, deterministic |

It is **load-bearing, not decorative**: remove GuardianRail and the agent signs whatever a
server demands. The entire skill exists to sit in that one gap.

## Quick Start

```bash
npm install @x402/core @x402/evm @x402/express @x402/fetch express viem dotenv
npm install -D tsx typescript @types/node @types/express
# contracts — install BOTH libs:
forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts
```

```bash
cp .env.example .env        # fill AGENT_PK, FACILITATOR_PK, RECEIVER_ADDRESS
npm run bench               # GuardianRail attack table (offline)
forge test                  # AgentVault suite (offline)
forge script script/DeployMockUSDC.s.sol --rpc-url atlantic --broadcast   # → set USDC_ADDRESS in .env
npm run probe               # prove EIP-3009 settlement on Atlantic
npm run server &            # x402-protected server (in-process facilitator)
npm run demo                # guarded agent pays end-to-end → settles 0.001 USDC
```

## Skill-to-Agent demo

`npm run agent` runs an autonomous agent on a GuardianRail-guarded wallet: given a budget and a goal, it
shops an x402 data marketplace with **every purchase gated by `createGuardedFetch` before any signature.**
Set `ANTHROPIC_API_KEY` for a live Claude (`claude-opus-4-8`) tool-use loop; with no key it runs a
deterministic planner (offline). GuardianRail blocks the drain, token-spoof, rogue-payee, sim-revert, and
over-budget buys; the agent adapts and finishes within budget — the real, shipped guard protecting a real
agent loop.

## MCP server (use from any MCP client)

`npm run mcp` exposes the **shipped** guard brain (`evaluateRequirement`, unchanged) as a
[Model Context Protocol](https://modelcontextprotocol.io) server over stdio — so Claude Desktop,
Cursor, or any MCP-capable runtime can gate an x402 payment with zero PayGuard-specific code.

| Tool | Input | Returns |
|---|---|---|
| `evaluate_payment` | `asset`, `amount`, `payTo` (+ optional `simulationOk`, per-call cap tightening) | `{ allowed, code, reason, amount }` |
| `get_policy` | — | active operator policy (limits, target asset, allowlist) |

Policy is operator-controlled via env (`PAYGUARD_MAX_SPEND`, `PAYGUARD_DAILY_BUDGET`,
`PAYGUARD_TARGET_ASSET`, `PAYGUARD_ALLOWED_PAYEES`); a calling agent can only **tighten** it,
never widen it. Example Claude Desktop config:

```json
{ "mcpServers": { "payguard": { "command": "npx", "args": ["tsx", "src/mcp.ts"] } } }
```

## Security → CertiK mapping

| PayGuard control | Attack it stops |
|---|---|
| `targetAsset` strict-equality | token-spoofing / look-alike asset phishing |
| `maxSpendPerCall` + `dailyBudgetRemaining` | wallet draining via runaway/looping agents |
| `allowedPayees` whitelist | exfiltration to a rogue / attacker-controlled payee |
| `eth_call` pre-flight simulation | paying into reverts, paused contracts, blacklists |
| `AgentVault`: `SafeERC20` + `ReentrancyGuard` + CEI | reentrancy / non-standard-token drains |
| Minimal contract (no streaming/upgrade/delegatecall) | reduced audit surface for the scanner |

## Limitations & threat boundaries

GuardianRail is a **pre-signature policy gate**, not a universal safety net. It deliberately does **not** cover:

- **A compromised agent key.** If the signing key is stolen, the attacker bypasses the guard entirely. PayGuard shrinks blast radius (per-call + daily caps) but is not a substitute for key security.
- **A malicious or lying RPC.** The `eth_call` simulation trusts the configured RPC; a hostile endpoint can return a false `ok`. Point it at an RPC you trust.
- **Post-settlement clawback.** Once a payment passes policy and is signed, settlement follows x402/EIP-3009 semantics — GuardianRail does not reverse a settled transfer.
- **AgentVault is unaudited.** Minimal, 100%-covered, and Slither-clean, but it has **not** had a paid third-party audit and targets Pharos Atlantic **testnet** with MockUSDC — not mainnet custody of real funds.

These boundaries are intentional: the skill does one job — stop unauthorized spends *before* signing — deterministically. Full disclosure policy in `SECURITY.md`.

## Test evidence (reproducible)

- **GuardianRail**: `npm run bench` → **8/8** attack vectors handled (deterministic, offline).
- **Guard edges**: `npm run test:guard` → **20/20** unit checks (boundary amounts, malformed/negative/unsafe/hex coercion, case-insensitive asset & payee, check precedence, per-session budget accumulator).
- **AgentVault + MockUSDC**: `forge test` → **20/20** (AgentVault **14/14** below + MockUSDC **6/6**), including a 256-run fuzz invariant, a constructor zero address validation, and a live reentrancy attack:

```text
Ran 14 tests for test/AgentVault.t.sol:AgentVaultTest
[PASS] testFuzz_BalanceMatchesTotalLocked(uint256) (runs: 256)
[PASS] test_AnyoneWithPreimageCanRelease()
[PASS] test_LockThenRelease()
[PASS] test_ReentrancyGuardBlocksReentry()
[PASS] test_RefundAfterDeadline()
[PASS] test_RevertWhen_DoubleRelease()
[PASS] test_RevertWhen_PastDeadline()
[PASS] test_RevertWhen_RefundBeforeDeadline()
[PASS] test_RevertWhen_RefundOnReleased()
[PASS] test_RevertWhen_ReleaseAfterDeadline()
[PASS] test_RevertWhen_ReleaseWithWrongPreimageByThirdParty()
[PASS] test_RevertWhen_USDCZeroAddress()
[PASS] test_RevertWhen_WrongPreimage()
[PASS] test_RevertWhen_ZeroAmount()
Suite result: ok. 14 passed; 0 failed; 0 skipped
```

- **End-to-end**: `npm run server & npm run demo` → a GuardianRail-guarded agent pays the x402 server and the in-process facilitator **settles 0.001 USDC on Atlantic** (receiver balance moves on-chain), returning the protected content.

## Settlement & Hybrid Facilitator (Option 3)

PayGuard defaults to the official Pharos x402 facilitator (`FACILITATOR_URL`) and ships a
self-hosted fallback (`src/facilitator.ts`, built on `x402Facilitator` + `toFacilitatorEvmSigner`)
that settles in-process — deterministic demo even if the public facilitator is unavailable.

**Phase 1 deployment proof (Pharos Atlantic, chain 688689):**

| Artifact | Value |
|---|---|
| MockUSDC (EIP-3009) | [`0xe54205649D6d41Aa9cCdD5667eaDB62f1dFA84AC`](https://atlantic.pharosscan.xyz/address/0xe54205649D6d41Aa9cCdD5667eaDB62f1dFA84AC) |
| Settlement tx | [`0xfd6e66157765066d9ff76068ee9476549153ade951036f3f7863a29f2ffbc253`](https://atlantic.pharosscan.xyz/tx/0xfd6e66157765066d9ff76068ee9476549153ade951036f3f7863a29f2ffbc253) |

> Verified on-chain on [Hemera SocialScan](https://atlantic.pharosscan.xyz/tx/0xfd6e66157765066d9ff76068ee9476549153ade951036f3f7863a29f2ffbc253) —
> `eth_getTransactionReceipt` → `status: 0x1 (success)`, block 24099194,
> on Pharos Atlantic (688689) via RPC `https://atlantic.dplabs-internal.com/`.

## Payment Flow (with GuardianRail injected)

```
1. Agent → GET protected endpoint
2. Server → 402 + PAYMENT-REQUIRED (accepts: [{ asset, amount, payTo, network }])
3. GuardianRail → enforce GuardPolicy + eth_call simulation   ◀── before any signature
      ├─ violation → throw AgentSecurityError (agent never signs)
      └─ AUTHORIZED → commit spend, pin the 402 to the validated requirement, pass it through
4. x402 client → sign EIP-3009 authorization, re-send with X-PAYMENT
5. Facilitator → settle transferWithAuthorization (USDC) on Atlantic
6. Server → 200 + PAYMENT-RESPONSE
```

## Resources

- x402: https://docs.x402.org · Pharos x402: https://docs.pharos.xyz/developer-guide/x402
- Reference skill: https://github.com/PharosNetwork/examples/tree/main/skills/x402-pharos
