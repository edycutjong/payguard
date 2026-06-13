/**
 * malicious_bench.ts — PayGuard's "money shot". Wraps a poisoned mock fetch with
 * createGuardedFetch and proves deterministic blocking of agent-draining attacks.
 * Fully offline (no RPC, no keys). Screenshot the console.table for the SKILL.md hero.
 *
 * Run: npx tsx bench/malicious_bench.ts
 */
import { createGuardedFetch, AgentSecurityError, type GuardPolicy, type Address } from '../src/guardrail';
import type { PaymentRequirements } from '@x402/fetch';
import type { SimResult } from '../src/simulate';

const USDC: Address = '0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8';
const FAKE: Address = '0x00000000000000000000000000000000DeaDBeef';
const AGENT: Address = '0x000000000000000000000000000000000000A6E7';
const WHITELISTED: Address = '0x000000000000000000000000000000000000bEEF';
const UNKNOWN: Address = '0x0000000000000000000000000000000000001337';

const basePolicy = (): GuardPolicy => ({
  agentAddress: AGENT,
  maxSpendPerCall: 5_000_000n,        // 5 USDC
  dailyBudgetRemaining: 10_000_000n,  // 10 USDC/day
  targetAsset: USDC,
  allowedPayees: [WHITELISTED],
  enforceSimulation: true,
});

// A 402-producing mock fetch carrying one poisoned requirement.
const poisoned = (req: Partial<PaymentRequirements>): typeof fetch =>
  (async () => new Response(
    JSON.stringify({ x402Version: 1, accepts: [{
      scheme: 'exact', network: 'eip155:688689', asset: USDC, amount: '1000',
      payTo: WHITELISTED, maxTimeoutSeconds: 60, extra: {}, ...req,
    }] }),
    { status: 402, headers: { 'content-type': 'application/json' } },
  )) as unknown as typeof fetch;

// Mock simulator: reverts only when the requirement is tagged for the revert case.
const mockSim = async (r: PaymentRequirements): Promise<SimResult> =>
  (r.extra as any)?.__revert
    ? { ok: false, revertReason: 'ERC20: transfer amount exceeds balance' }
    : { ok: true };

interface Case { attack: string; req: Partial<PaymentRequirements>; expect: string; }
const cases: Case[] = [
  { attack: '1. The Drainer (10,000 USDC)', req: { amount: '10000000000' },        expect: 'MAX_SPEND' },
  { attack: '2. The Phish (0xFakeToken)',    req: { asset: FAKE },                  expect: 'INVALID_ASSET' },
  { attack: '3. The Rogue Node (bad payTo)', req: { payTo: UNKNOWN },              expect: 'UNAPPROVED_PAYEE' },
  { attack: '4. The Revert (sim fails)',     req: { extra: { __revert: true } },   expect: 'SIMULATION_FAILED' },
  { attack: '5. The Clean Run',              req: {},                               expect: 'AUTHORIZED' },
];

const rows: Record<string, string>[] = [];
let failures = 0;

for (const c of cases) {
  const guarded = createGuardedFetch(poisoned(c.req), basePolicy(), { simulator: mockSim });
  let result = '', code = '', reason = '';
  try {
    await guarded('https://api.example/paid');
    result = '✅ AUTHORIZED'; code = 'AUTHORIZED'; reason = 'under budget, whitelisted, sim ok';
  } catch (e) {
    if (e instanceof AgentSecurityError) { result = '🛑 BLOCKED'; code = e.code; reason = e.message; }
    else throw e;
  }
  const pass = code === c.expect;
  if (!pass) failures++;
  rows.push({ 'Attack Vector': c.attack, Result: result, 'Guard Code': code, Reason: reason.slice(0, 46) });
}

console.log('\n  🛡️  PayGuard · GuardianRail — Attack → Blocked\n');
console.table(rows);
console.log(`\n  ${failures === 0 ? '✅' : '❌'} ${cases.length - failures}/${cases.length} vectors handled correctly` +
            (failures === 0 ? ' — 100% of unauthorized agent spends blocked.\n' : `  (${failures} FAILED)\n`));
process.exit(failures === 0 ? 0 : 1);
