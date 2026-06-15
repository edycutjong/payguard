# 🎬 PayGuard — 2-3 min demo video script

A one-take screen recording that proves the core claims. Total target: **~2:30**.
Record terminal at a large font (≥18pt), light-on-dark. Tools: QuickTime / OBS / Loom.

> When the video is up, paste its URL into **README.md** — replace the `#-see-it-in-action`
> target on the `Demo Video` badge (there's a `<!-- VIDEO: ... -->` marker right above it).

## Before you hit record
```bash
cd PayGuard
npm install >/dev/null 2>&1            # warm caches so installs don't eat screen time
forge build  >/dev/null 2>&1
clear
```

## Shot list

| # | ~Time | On screen | Say (voiceover / caption) |
|---|---|---|---|
| 1 | 0:00–0:15 | Title slide or `README.md` hero | "x402 lets AI agents pay autonomously on Pharos — but it signs **whatever** a server asks. One hallucination drains the wallet. PayGuard is the seatbelt." |
| 2 | 0:15–0:45 | `npm run bench` | "GuardianRail faces 8 attack vectors — drainer, token-spoof, rogue payee, revert, negative amount. **8/8 blocked before the agent ever signs.**" Let the table render; pause on the green `8/8`. |
| 3 | 0:45–1:15 | `npm run agent` | "Now the *shipped* guard on a live autonomous agent. Same code, real loop: it shops an x402 data market and every unsafe buy is stopped — drain, spoof, rogue-payee, revert, over-budget. **5/5 blocked, finishes under budget.**" |
| 4 | 1:15–1:45 | `forge test` | "The escrow contract — AgentVault. **21/21**, including a 256-run fuzz invariant and a live re-entrancy attack. 100% coverage, Slither-clean." Pause on `21 passed`. |
| 5 | 1:45–2:15 | Browser → [explorer tx](https://atlantic.pharosscan.xyz/tx/0xfd6e66157765066d9ff76068ee9476549153ade951036f3f7863a29f2ffbc253) | "Not a mock — a guarded agent really settled USDC on Pharos Atlantic. Here's the transaction on-chain, status success." Scroll to show status + token transfer. |
| 6 | 2:15–2:30 | `SKILL.md` top / repo | "Two composable Skills any Pharos agent imports. GuardianRail + AgentVault. That's PayGuard." |

## Optional B-roll (if you want it tighter)
- `npm run mcp` for ~3s to show the **MCP server** banner — proves standard (MCP) compatibility.
- Split-screen the bench table next to the agent run.

## Caption / description to paste under the video
> PayGuard — the CertiK-grade safety layer for x402 on Pharos. GuardianRail blocks 8/8
> agent-drain attacks pre-signature; AgentVault escrows milestone payments (21/21 tests,
> 100% coverage). Real on-chain settlement on Pharos Atlantic. Pharos Skill Hackathon, Phase 1.
