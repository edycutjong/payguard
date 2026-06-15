/**
 * guard_unit.ts — fine-grained unit checks on GuardianRail's pure brain.
 *
 * The attack bench (malicious_bench.ts) proves the 8 headline vectors. This file locks down
 * the *edges* that keep a hostile server from sneaking past: boundary amounts, malformed /
 * negative / unsafe-integer / hex amounts, case-insensitive asset & payee matching, check
 * precedence, simulation gating, and the per-session budget accumulator. All offline, no RPC.
 *
 * Run: npx tsx bench/guard_unit.ts   (wired into `npm run ci`)
 */
import {
  evaluateRequirement,
  createGuardedFetch,
  AgentSecurityError,
  type GuardPolicy,
  type Address,
} from '../src/guardrail';
import type { PaymentRequirements } from '@x402/fetch';
import type { SimResult } from '../src/simulate';

const USDC: Address = '0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8';
const USDC_LOWER = USDC.toLowerCase() as Address;
const FAKE: Address = '0x00000000000000000000000000000000DeaDBeef';
const AGENT: Address = '0x000000000000000000000000000000000000A6E7';
const PAYEE: Address = '0x000000000000000000000000000000000000bEEF';
const PAYEE_UPPER = ('0x' + PAYEE.slice(2).toUpperCase()) as Address;
const OTHER: Address = '0x0000000000000000000000000000000000001337';

const policy = (over: Partial<GuardPolicy> = {}): GuardPolicy => ({
  agentAddress: AGENT,
  maxSpendPerCall: 5_000_000n,        // 5 USDC
  dailyBudgetRemaining: 10_000_000n,  // 10 USDC/day
  targetAsset: USDC,
  allowedPayees: [PAYEE],
  enforceSimulation: false,
  ...over,
});

const reqOf = (over: Partial<PaymentRequirements> = {}): PaymentRequirements =>
  ({
    scheme: 'exact', network: 'eip155:688689', asset: USDC, amount: '1000',
    payTo: PAYEE, maxTimeoutSeconds: 60, extra: {}, ...over,
  } as unknown as PaymentRequirements);

/** Resolve a guard code even when amountOf() throws before policy evaluation. */
function codeOf(req: PaymentRequirements, pol: GuardPolicy, sim?: SimResult): string {
  try {
    return evaluateRequirement(req, pol, sim).code;
  } catch (e) {
    if (e instanceof AgentSecurityError) return e.code;
    throw e;
  }
}

let pass = 0;
let fail = 0;
const check = (name: string, got: string, want: string) => {
  const ok = got === want;
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name.padEnd(46)} → ${got}${ok ? '' : `  (expected ${want})`}`);
};

console.log('\n  🔬 GuardianRail — guard-brain unit checks\n');

// --- amount coercion & boundaries -------------------------------------------------
check('amount == maxSpendPerCall is allowed',     codeOf(reqOf({ amount: '5000000' }), policy()), 'AUTHORIZED');
check('amount == maxSpendPerCall + 1 blocked',    codeOf(reqOf({ amount: '5000001' }), policy()), 'MAX_SPEND');
check('missing amount rejected',                  codeOf(reqOf({ amount: undefined as any }), policy()), 'INVALID_ASSET');
check('float string amount rejected',             codeOf(reqOf({ amount: '1.5' as any }), policy()), 'INVALID_ASSET');
check('negative amount cannot inflate budget',    codeOf(reqOf({ amount: '-5000' as any }), policy()), 'MAX_SPEND');
check('zero amount rejected',                     codeOf(reqOf({ amount: '0' as any }), policy()), 'MAX_SPEND');
check('unsafe-integer number amount rejected',    codeOf(reqOf({ amount: 1e30 as any }), policy()), 'MAX_SPEND');
check('hex amount parsed and bounded (0x10=16)',  codeOf(reqOf({ amount: '0x10' as any }), policy()), 'AUTHORIZED');

// --- asset & payee matching (case-insensitive) ------------------------------------
check('asset match is case-insensitive',          codeOf(reqOf({ asset: USDC_LOWER }), policy()), 'AUTHORIZED');
check('spoofed asset blocked',                    codeOf(reqOf({ asset: FAKE }), policy()), 'INVALID_ASSET');
check('payee allowlist is case-insensitive',      codeOf(reqOf({ payTo: PAYEE_UPPER }), policy()), 'AUTHORIZED');
check('unapproved payee blocked',                 codeOf(reqOf({ payTo: OTHER }), policy()), 'UNAPPROVED_PAYEE');

// --- simulation gating ------------------------------------------------------------
check('failing sim blocks when enforced',         codeOf(reqOf(), policy({ enforceSimulation: true }), { ok: false, revertReason: 'paused' }), 'SIMULATION_FAILED');
check('failing sim ignored when disabled',        codeOf(reqOf(), policy({ enforceSimulation: false }), { ok: false }), 'AUTHORIZED');

// --- check precedence (asset → payee → spend) -------------------------------------
check('asset checked before spend cap',           codeOf(reqOf({ asset: FAKE, amount: '9999999999' }), policy()), 'INVALID_ASSET');
check('payee checked before spend cap',           codeOf(reqOf({ payTo: OTHER, amount: '9999999999' }), policy()), 'UNAPPROVED_PAYEE');

// --- per-session budget accumulator (via createGuardedFetch) ----------------------
const mock402 = (amount: string): typeof fetch =>
  (async () =>
    new Response(JSON.stringify({ x402Version: 1, accepts: [reqOf({ amount })] }), {
      status: 402,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
const okSim = async (): Promise<SimResult> => ({ ok: true });
const tryFetch = async (g: typeof fetch): Promise<string> => {
  try { await g('https://api.example/paid'); return 'AUTHORIZED'; }
  catch (e) { if (e instanceof AgentSecurityError) return e.code; throw e; }
};

{
  // one session, 6 USDC/day, 5 USDC/call: first 4-USDC buy clears, second would total 8 > 6.
  const g = createGuardedFetch(mock402('4000000'), policy({ dailyBudgetRemaining: 6_000_000n, enforceSimulation: true }), { simulator: okSim });
  check('session budget: 1st 4-USDC buy clears',  await tryFetch(g), 'AUTHORIZED');
  check('session budget: 2nd buy depletes (8>6)', await tryFetch(g), 'BUDGET_EXCEEDED');
}
{
  // two fetches from the SAME policy must not bleed budget into each other.
  const pol = policy({ dailyBudgetRemaining: 6_000_000n, enforceSimulation: true });
  const gA = createGuardedFetch(mock402('4000000'), pol, { simulator: okSim });
  const gB = createGuardedFetch(mock402('4000000'), pol, { simulator: okSim });
  check('session isolation: fetch A independent', await tryFetch(gA), 'AUTHORIZED');
  check('session isolation: fetch B independent', await tryFetch(gB), 'AUTHORIZED');
}

const total = pass + fail;
console.log(`\n  ${fail === 0 ? '✅' : '❌'} ${pass}/${total} guard-brain unit checks passed` +
            (fail === 0 ? ' — every edge case locked down.\n' : `  (${fail} FAILED)\n`));
process.exit(fail === 0 ? 0 : 1);
