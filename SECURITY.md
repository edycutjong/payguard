# Security Policy

PayGuard is a security-first project — it exists to keep autonomous agents from being
drained over x402. We hold our own code to the same bar, so responsible disclosure of
any weakness is genuinely welcomed.

> ⚠️ **Hackathon / testnet scope.** PayGuard was built for the Pharos Skill Hackathon
> (Phase 1). It runs against **Pharos Atlantic testnet** with a **MockUSDC** token and
> **no real funds**. The contracts have **not** been through a paid third-party audit and
> are **not** intended for mainnet or production custody of value as-is. Treat all
> deployments as experimental.

## Supported Versions

Security fixes are applied to the latest `main` only. There is no long-term-support branch.

| Version | Supported |
|---|---|
| `main` (latest) | ✅ |
| older commits / tags | ❌ |

## Reporting a Vulnerability

**Please do not open a public issue, PR, or discussion for a security problem.**

Report privately through either channel:

1. **GitHub Private Vulnerability Reporting** (preferred) —
   <https://github.com/edycutjong/payguard/security/advisories/new>
2. **Email** — edy.cu@live.com with the subject line `[PayGuard][Security] <short summary>`

Please include, as far as you can:

- the affected component (`src/guardrail.ts`, `src/simulate.ts`, `contracts/AgentVault.sol`, etc.);
- the version / commit hash you tested;
- a description of the impact (what an attacker gains);
- reproduction steps or a proof-of-concept (a failing test or bench vector is ideal);
- any suggested remediation.

### What to expect

| Stage | Target |
|---|---|
| Acknowledgement of your report | within **72 hours** |
| Initial assessment / severity triage | within **7 days** |
| Fix or mitigation for confirmed high/critical issues | as fast as practical |
| Public disclosure / credit | coordinated with you after a fix lands |

This is a solo-maintained hackathon project, so timelines are best-effort rather than
contractual. We will keep you updated and are happy to credit you in the advisory and
release notes unless you prefer to stay anonymous.

## Scope

**In scope**

- The GuardianRail pre-flight interceptor (`src/guardrail.ts`, `src/simulate.ts`, `src/rpc.ts`).
- The x402 client / server / facilitator flow (`src/demo.ts`, `src/server.ts`, `src/facilitator.ts`).
- The escrow and token contracts (`contracts/AgentVault.sol`, `contracts/MockUSDC.sol`).
- Any way to make GuardianRail **authorize** a payment it should have blocked
  (spend-cap bypass, asset-spoof bypass, payee-allowlist bypass, simulation bypass,
  TOC/TOU between the validated requirement and the signed authorization).

**Out of scope**

- The MockUSDC test token having no real-world value, or testnet-only behavior.
- Findings that require a compromised private key, malicious RPC endpoint you control
  end-to-end, or physical/host access.
- Denial of service against the public Pharos facilitator or RPC (not owned by this project).
- Issues solely in third-party dependencies — please report those upstream
  (we still appreciate a heads-up so we can pin/patch).
- Lint style notes (e.g. `screaming-snake-case-immutable`) and other non-exploitable findings.

## Security Model (for context)

PayGuard's whole purpose is to stop unauthorized agent spends *before* a signature is
ever produced. The controls a report would typically try to defeat:

| Control | Attack it stops |
|---|---|
| `targetAsset` strict-equality | token-spoofing / look-alike phishing |
| `maxSpendPerCall` + `dailyBudgetRemaining` | wallet draining via looping / hallucinating agents |
| `allowedPayees` allowlist | exfiltration to a rogue payee |
| `eth_call` pre-flight simulation | paying into reverting / paused / blacklisted contracts |
| validated-requirement pinning | TOC/TOU between the `402` offer and the signed EIP-3009 authorization |
| `SafeERC20` + `ReentrancyGuard` + strict CEI | reentrancy / non-standard-token drains in `AgentVault` |
| minimal, non-upgradeable contract (no streaming / upgrade / delegatecall) | reduced attack surface |

## Automated Security Tooling

Every push and PR runs a 3-stage GitHub Actions pipeline (Quality · Security · Gate):

- **Slither** — Solidity static analysis (0 high / 0 medium).
- **CodeQL** — TypeScript static analysis.
- **TruffleHog** — secret scanning (`--only-verified`).
- **npm audit** + **Dependabot** — dependency / supply-chain monitoring.
- **Foundry** — 21 tests incl. 256-run fuzzing, reentrancy, and EIP-3009 coverage (100% on `contracts/`).
- **GuardianRail bench** — 8/8 attack vectors asserted on every run (`npm run bench`).

A regression in any of these is treated as a potential security issue.

## Safe Harbor

We will not pursue or support legal action against researchers who:

- act in good faith and avoid privacy violations, data destruction, or service disruption;
- only test against their **own** local or testnet deployments (never other users' agents,
  the public facilitator, or shared RPC infrastructure);
- give us reasonable time to remediate before any public disclosure.

Thank you for helping keep agent payments safe. 💂

_MIT © 2026 Edy Cu_
