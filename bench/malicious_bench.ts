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
  { attack: '5. The Inflator (negative amt)', req: { amount: '-5000' },            expect: 'MAX_SPEND' },
  { attack: '6. The Malformed (float amt)',  req: { amount: '1.5' },               expect: 'INVALID_ASSET' },
  { attack: '7. The Clean Run',              req: {},                               expect: 'AUTHORIZED' },
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

// TOC/TOU array-spoof proof: a 2-entry offer (cheap + costly) must be pinned to ONLY the
// validated cheap entry, so the wrapped x402 client can never sign the expensive sibling.
const mk = (amount: string): PaymentRequirements => ({
  scheme: 'exact', network: 'eip155:688689', asset: USDC, amount,
  payTo: WHITELISTED, maxTimeoutSeconds: 60, extra: {},
} as unknown as PaymentRequirements);
const spoof = (async () => new Response(
  JSON.stringify({ x402Version: 1, accepts: [mk('1'), mk('1000000000')] }),
  { status: 402, headers: { 'content-type': 'application/json' } },
)) as unknown as typeof fetch;

const pinnedRes = await createGuardedFetch(spoof, basePolicy(), { simulator: mockSim })('https://api.example/paid');
const pinned: any = await pinnedRes.json();
const amounts = Array.isArray(pinned?.accepts) ? pinned.accepts.map((a: any) => a.amount) : [];
const pinnedOk = amounts.length === 1 && amounts[0] === '1';
if (!pinnedOk) failures++;
console.log(`\n  ${pinnedOk ? '✅' : '❌'} TOC/TOU pin — 2-entry offer [1, 1000000000] collapsed to validated [${amounts.join(', ')}]`);

const total = cases.length + 1;
console.log(`\n  ${failures === 0 ? '✅' : '❌'} ${total - failures}/${total} vectors handled correctly` +
            (failures === 0 ? ' — 100% of unauthorized agent spends blocked.\n' : `  (${failures} FAILED)\n`));
process.exit(failures === 0 ? 0 : 1);
