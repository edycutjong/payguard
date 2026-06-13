<div align="center">
  <img src="docs/icon-animated.svg" width="140" alt="PayGuard">

  <h1>PayGuard 💂</h1>
  <p><em>The CertiK-grade seatbelt for x402 — safe, guarded agent payments on Pharos.</em></p>

  [![Agent Skill](https://img.shields.io/badge/📜_Agent-Skill-06B6D4?style=for-the-badge)](SKILL.md)
  [![Demo Video](https://img.shields.io/badge/▶_Demo-Video-EF4444?style=for-the-badge)](#)
  [![On-chain Settled](https://img.shields.io/badge/🛰️_On--chain-Settled-22C55E?style=for-the-badge)](#-phase-1-on-chain-proof-pharos-atlantic-688689)
  [![Pharos Hackathon](https://img.shields.io/badge/🏆_Pharos-Skill_Hackathon-8B5CF6?style=for-the-badge)](https://dorahacks.io/hackathon/pharos-phase1)

  <br/><br/>

  ![Solidity](https://img.shields.io/badge/Solidity-0.8.28-363636?logo=solidity)
  ![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
  ![x402](https://img.shields.io/badge/x402-v2-8b5cf6)
  ![tested with Foundry](https://img.shields.io/badge/tested%20with-Foundry-black)
  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
  [![CI](https://github.com/edycutjong/payguard/actions/workflows/ci.yml/badge.svg)](https://github.com/edycutjong/payguard/actions/workflows/ci.yml)
  [![CodeQL](https://github.com/edycutjong/payguard/actions/workflows/codeql.yml/badge.svg)](https://github.com/edycutjong/payguard/actions/workflows/codeql.yml)
</div>

---

## 🚀 Run it — for judges

> **Verify the core claims in 30 seconds — zero keys, zero accounts, fully offline:**

```bash
npm install && npm run bench                                         # → 8/8 attacks blocked
forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts && forge test   # → 21/21 + fuzz + reentrancy
npm run agent                                                        # → autonomous agent; GuardianRail blocks 5/5 unsafe buys (offline, no key)
```

Want the live on-chain settlement too? It's a real testnet tx you can verify without running anything —
see [Phase 1 on-chain proof](#-phase-1-on-chain-proof-pharos-atlantic-688689). To reproduce it locally
(needs a funded Atlantic test wallet):

```bash
cp .env.example .env          # fill AGENT_PK, FACILITATOR_PK, RECEIVER_ADDRESS (see comments)
forge script script/DeployMockUSDC.s.sol --rpc-url atlantic --broadcast   # prints MockUSDC → set USDC_ADDRESS
npm run probe                 # prove EIP-3009 settlement on Atlantic
npm run server                # terminal 1 — x402-protected resource server
npm run demo                  # terminal 2 — guarded agent pays end-to-end (settles 0.001 USDC)
```

## 📸 See it in action

<p align="center">
  <img src="docs/readme-hero-animated.svg" width="100%" alt="PayGuard — GuardianRail blocks 8/8 agent-drain attacks and settles on Pharos">
</p>

**GuardianRail faces 8 attack vectors — every unauthorized spend is blocked *before* the agent ever signs:**

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

---

## 🤖 Skill-to-Agent — the guard protecting a live agent

`npm run agent` turns GuardianRail loose on an autonomous agent. A procurement agent is given a budget and a
goal (*"assemble a trading-research data bundle"*) and shops an x402 data marketplace — **every purchase gated
by the shipped `createGuardedFetch` before any signature.** Set `ANTHROPIC_API_KEY` for a live **Claude
(`claude-opus-4-8`)** tool-use loop; with no key it runs a deterministic planner (offline, identical every run):

```text
🤖 autonomous agent · goal: assemble a safe research bundle under 5 USDC/day
   ✅ DataHub       AUTHORIZED — charged 0.5 USDC
   🛑 AlphaDrainer  BLOCKED [MAX_SPEND]          10,000 USDC > 5 USDC per-call cap
   ✅ WeatherWire   AUTHORIZED — charged 2 USDC
   🛑 CheapFeed     BLOCKED [INVALID_ASSET]      spoofed token, not USDC
   🛑 GhostNode     BLOCKED [UNAPPROVED_PAYEE]   payee not in allowlist
   🛑 PausedOracle  BLOCKED [SIMULATION_FAILED]  eth_call would revert
   🛑 NewsFeed      BLOCKED [BUDGET_EXCEEDED]    3 USDC > 2.5 USDC left today
  💰 spent 2.5 / 5 USDC · 5 unsafe payments blocked — every drain, spoof, rogue-payee,
     revert, and over-budget attempt stopped BEFORE the agent ever signs.
```

It reuses the **shipped** guard unchanged — the real GuardianRail protecting a real agent loop, not a
reimplementation. The EIP-3009 authorization for a blocked buy is never created.

## 💡 The problem & solution

x402 is Pharos's flagship agent-payment rail — but it signs and settles **whatever** a server's
`402 PAYMENT-REQUIRED` demands. One LLM hallucination or one rogue endpoint can drain an agent's
wallet in seconds: **no spend caps, no simulation, no asset checks, no escrow.**

**PayGuard is the safety layer x402 is missing** — two composable, atomic Skills any Pharos agent imports:

- 🚦 **GuardianRail** — a pre-flight interceptor that enforces spend caps, asset-spoof protection, payee allowlists, and an `eth_call` simulation *before* the agent signs the EIP-3009 authorization.
- 🏦 **AgentVault** — a minimal, non-upgradeable, CertiK-grade USDC escrow for conditional / milestone payments.
- 🛰️ **Proven end-to-end** — a guarded agent really settles USDC on Pharos Atlantic (verifiable [tx below](#-phase-1-on-chain-proof-pharos-atlantic-688689)).

## 🛠️ The two Skills

### 🚦 Tool 1 — `GuardianRail` (pre-flight payment interceptor)
Nests *under* the x402 client via `createGuardedFetch`, so it gates the `402` offer before signing:

```ts
const guarded  = createGuardedFetch(fetch, policy, { rpcUrl });
const safeFetch = wrapFetchWithPayment(guarded, client);   // throws AgentSecurityError on violation
```
Enforces: canonical-asset (anti-spoof) · per-call cap · daily budget · payee allowlist · `eth_call` simulation.

### 🏦 Tool 2 — `AgentVault` (conditional USDC escrow)
Minimal, non-upgradeable, strict-CEI escrow (`SafeERC20` + `ReentrancyGuard`) for milestone payments:
`lock(payee, amount, conditionHash, deadline)` → `release(id, preimage)` / `refund(id)`.

## 🏗️ Architecture (Hybrid facilitator — "Option 3")

```mermaid
graph TD
    Agent[Agent] --> Guard["createGuardedFetch(policy)<br/>enforce + eth_call sim (pre-signature)"]
    Guard --> Client["x402 client (EIP-3009 sign)"]
    Guard --> Server["x402 server (/api/data, 402)"]
    Server --> Fac[Facilitator]
    Fac --> Def["default: official Pharos FACILITATOR_URL"]
    Fac --> Fall["fallback: in-process x402Facilitator (self-hosted)"]
    Def --> Settles["settles USDC on Atlantic (688689)"]
    Fall --> Settles
    AV["High-value path: AgentVault.sol"] --> Actions["lock → release(proof) / refund(deadline)"]
```
The in-process facilitator implements `FacilitatorClient` directly, so the self-hosted fallback
needs **no HTTP-facilitator service** — the demo is deterministic even if the public facilitator is down.

## 🏆 Tracks & sponsor tech → *where in the code*

> For judges — exactly which Pharos / sponsor tech PayGuard uses and where to find it.

| Track / Tech | How PayGuard uses it | Where in the code |
|---|---|---|
| **Pharos `x402`** (flagship rail) | guarded client · resource server · in-process facilitator settling EIP-3009 | `src/guardrail.ts` · `src/server.ts` · `src/facilitator.ts` · `src/demo.ts` |
| **Phase 1 — Skill** | Anthropic Agent Skill module (the deliverable) | `SKILL.md` |
| **CertiK Skill Scanner** (security standard) | minimal SafeERC20 + ReentrancyGuard + strict-CEI escrow · 100% test coverage · Slither-clean | `contracts/AgentVault.sol` |
| **Pharos Atlantic (688689)** | real, verifiable on-chain settlement | tx [`0xfd6e66…`](#-phase-1-on-chain-proof-pharos-atlantic-688689) |

## ✅ Proven (reproducible)

```text
$ npm run bench          # GuardianRail — offline, deterministic
  ✅ 8/8 vectors handled correctly — 100% of unauthorized agent spends blocked.

$ forge test             # AgentVault + MockUSDC — OZ v5.6.1 / solc 0.8.28
  [PASS] testFuzz_BalanceMatchesTotalLocked(uint256) (runs: 256)
  [PASS] test_ReentrancyGuardBlocksReentry()        … (+19 more)
  21 tests passed; 0 failed; 0 skipped

$ forge coverage         # contracts/ (AgentVault + MockUSDC)
  100% lines · 100% statements · 100% branches · 100% functions

$ npm run server & npm run demo    # full guarded payment, end-to-end on Atlantic
  ✅ paid + received: { secret: 'PayGuard: safe x402 payment settled on Pharos Atlantic.' }
  # receiver USDC balance 2000 → 3000 on-chain — a real settlement, not just a 200
```
The complete flow is verified **end-to-end on Atlantic**: a GuardianRail-guarded agent pays the
x402 server, the in-process facilitator verifies and **settles 0.001 USDC on-chain**, and the
agent receives the protected content — all on `@x402/*` v2.14.

## 🧪 Engineering harness

| Layer | Tool | Status |
|---|---|---|
| Type safety | `tsc --noEmit` | ✅ |
| Skill tests | GuardianRail attack bench (8 vectors) | ✅ 8/8 |
| Contract tests | Foundry — 256-run fuzz + reentrancy + EIP-3009 | ✅ 21/21 |
| Contract coverage | `forge coverage` (contracts/) | ✅ 100% |
| Static analysis (Solidity) | Slither | ✅ 0 high / 0 medium |
| Static analysis (TypeScript) | CodeQL | ✅ |
| On-chain E2E | guarded payment settles on Atlantic | ✅ |
| Secret scanning | TruffleHog (`--only-verified`) | ✅ |
| Supply chain | npm audit + Dependabot | ✅ |

A 3-stage GitHub Actions pipeline (**Quality · Security · Gate**) runs on every push/PR — see
`.github/workflows/ci.yml`. Locally: `npm run ci` · `npm run typecheck` · `make security-scan`.

## 🔐 Security → CertiK mapping

| Control | Attack stopped |
|---|---|
| `targetAsset` strict-equality | token-spoofing / look-alike phishing |
| `maxSpendPerCall` + `dailyBudgetRemaining` | wallet draining via looping / hallucinating agents |
| `allowedPayees` allowlist | exfiltration to a rogue payee |
| `eth_call` pre-flight simulation | paying into reverts / paused / blacklisted contracts |
| `SafeERC20` + `ReentrancyGuard` + CEI | reentrancy / non-standard-token drains |
| minimal contract (no streaming / upgrade / delegatecall) | reduced scanner attack surface |

## 🔗 Phase 1 on-chain proof (Pharos Atlantic, 688689)

| Artifact | Value |
|---|---|
| MockUSDC (EIP-3009) | `0xe54205649D6d41Aa9cCdD5667eaDB62f1dFA84AC` |
| Settlement tx | `0xfd6e66157765066d9ff76068ee9476549153ade951036f3f7863a29f2ffbc253` |

> Verified on-chain — `status: success`, block `24099194`. Check it yourself:
> `eth_getTransactionByHash` on RPC `https://atlantic.dplabs-internal.com/`.

## 📁 Repo layout

```
SKILL.md                     Anthropic Agent Skill (the submission artifact)
src/guardrail.ts             Tool 1 — createGuardedFetch + pure evaluateRequirement
src/simulate.ts              eth_call pre-flight (injectable)
src/rpc.ts                   rate-limit-hardened viem transport (retryingHttp)
src/facilitator.ts           in-process x402Facilitator (self-hosted fallback)
src/server.ts                x402-protected resource server
src/demo.ts                  end-to-end guarded payment
src/agent.ts                 Skill-to-Agent — autonomous Claude agent on the guard
src/probe.ts                 EIP-3009 settlement probe
contracts/AgentVault.sol     Tool 2 — conditional escrow (100% coverage)
contracts/MockUSDC.sol       EIP-3009 test USDC (100% coverage)
script/DeployMockUSDC.s.sol  deploy MockUSDC → USDC_ADDRESS
test/AgentVault.t.sol        AgentVault suite (fuzz + reentrancy)
test/MockUSDC.t.sol          EIP-3009 transferWithAuthorization suite
bench/malicious_bench.ts     8/8 attack-vector bench
```

## Stack

`@x402/*` v2.14 · `viem` v2.52 · `express` · Foundry (solc 0.8.28, OZ v5.6.1) · TypeScript/ESM. MIT © 2026 Edy Cu.
