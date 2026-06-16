/**
 * GuardianRail — the safety layer x402 lacks.
 *
 * Seam (per spec): wrapFetchWithPayment(createGuardedFetch(fetch, policy), client).
 * createGuardedFetch nests UNDER the x402 client: it sees the raw 402 PAYMENT-REQUIRED
 * response before the client decodes/sign s the EIP-3009 authorization, enforces policy,
 * and throws AgentSecurityError to abort the signature — or returns the 402 so x402 proceeds.
 *
 * `evaluateRequirement()` is PURE + SYNC → the offline-testable brain.
 */
import type { PaymentRequirements, x402Client } from '@x402/fetch';
import { wrapFetchWithPayment } from '@x402/fetch';
import { makeSimulator, type SimResult } from './simulate';

export type Address = `0x${string}`;

export interface GuardPolicy {
  agentAddress: Address;          // the from of the simulated transfer
  maxSpendPerCall: bigint;        // base units (USDC = 6dp)
  dailyBudgetRemaining: bigint;   // cumulative, decremented on each authorized spend
  targetAsset: Address;           // canonical USDC — asserted strict-equal (anti-spoof)
  allowedPayees?: Address[];      // optional whitelist
  enforceSimulation?: boolean;    // default true
}

export type GuardCode =
  | 'AUTHORIZED' | 'MAX_SPEND' | 'INVALID_ASSET'
  | 'UNAPPROVED_PAYEE' | 'BUDGET_EXCEEDED' | 'SIMULATION_FAILED';

export interface GuardDecision {
  allowed: boolean;
  code: GuardCode;
  reason: string;
  amount: bigint;
  req: PaymentRequirements;
}

export class AgentSecurityError extends Error {
  constructor(public code: GuardCode, message: string) {
    super(message);
    this.name = 'AgentSecurityError';
  }
}

const eq = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/**
 * Coerce the offered amount to a strictly-positive bigint, or throw.
 * A hostile server can omit the field, send a float ("1.5") or junk string, or — the
 * dangerous one — a NEGATIVE value: `budgetRemaining -= (-x)` would *inflate* the budget
 * and sail past maxSpendPerCall. Anything that is not a positive integer is rejected here
 * rather than crashing the caller with a raw BigInt SyntaxError/TypeError.
 */
function amountOf(req: PaymentRequirements): bigint {
  const raw = (req as any).amount ?? (req as any).maxAmountRequired;
  if (raw === undefined || raw === null || raw === '')
    throw new AgentSecurityError('INVALID_ASSET', 'missing payment amount');
  if (typeof raw === 'number' && !Number.isSafeInteger(raw))
    throw new AgentSecurityError('MAX_SPEND', `amount ${raw} exceeds safe integer precision`);
  let amt: bigint;
  try {
    amt = BigInt(raw); // throws on floats and non-numeric strings
  } catch {
    throw new AgentSecurityError('INVALID_ASSET', `malformed amount ${String(raw)}`);
  }
  if (amt <= 0n)
    throw new AgentSecurityError('MAX_SPEND', `amount ${amt} must be strictly positive`);
  return amt;
}

/** PURE policy evaluation — the heart of the skill (see bench/malicious_bench.ts). */
export function evaluateRequirement(
  req: PaymentRequirements,
  policy: GuardPolicy,
  sim?: SimResult,
): GuardDecision {
  const amount = amountOf(req);
  const asset = req.asset as Address;
  const payTo = req.payTo as Address;
  const mk = (code: GuardCode, reason: string): GuardDecision =>
    ({ allowed: code === 'AUTHORIZED', code, reason, amount, req });

  if (!eq(asset, policy.targetAsset))
    return mk('INVALID_ASSET', `asset ${asset} != target USDC ${policy.targetAsset} (spoof?)`);
  if (policy.allowedPayees && !policy.allowedPayees.some((p) => eq(p, payTo)))
    return mk('UNAPPROVED_PAYEE', `payee ${payTo} not in allowlist`);
  if (amount > policy.maxSpendPerCall)
    return mk('MAX_SPEND', `amount ${amount} > maxSpendPerCall ${policy.maxSpendPerCall}`);
  if (amount > policy.dailyBudgetRemaining)
    return mk('BUDGET_EXCEEDED', `amount ${amount} > dailyBudgetRemaining ${policy.dailyBudgetRemaining}`);
  if (policy.enforceSimulation !== false && sim && !sim.ok)
    return mk('SIMULATION_FAILED', `eth_call revert: ${sim.revertReason ?? 'unknown'}`);

  return mk('AUTHORIZED', 'approved');
}

interface PaymentOffer { version: number; accepts: PaymentRequirements[]; }

/**
 * Read the 402 offer the way the x402 client does: PAYMENT-REQUIRED header first, then a
 * v1 JSON body. The base64 header is capped at 8KB so a hostile server can't hand us a
 * multi-megabyte blob to base64-decode + JSON-parse synchronously and stall the event loop.
 * `version` is preserved so the re-pinned offer round-trips through the client's schema.
 */
async function decodePaymentRequired(res: Response): Promise<PaymentOffer> {
  const hdr = res.headers.get('payment-required') ?? res.headers.get('x-payment-required');
  if (hdr) {
    if (hdr.length > 8192)
      throw new AgentSecurityError('SIMULATION_FAILED', `payment-required header ${hdr.length}B exceeds 8KB cap`);
    try {
      const obj: any = JSON.parse(Buffer.from(hdr, 'base64').toString('utf8'));
      if (Array.isArray(obj) && obj.length) return { version: 1, accepts: obj as PaymentRequirements[] };
      if (obj?.accepts?.length) return { version: obj.x402Version ?? 2, accepts: obj.accepts as PaymentRequirements[] };
    } catch { /* not a base64-JSON header — fall through to the body */ }
  }
  try {
    const body: any = await res.clone().json();
    if (body?.accepts?.length) return { version: body.x402Version ?? 1, accepts: body.accepts as PaymentRequirements[] };
  } catch { /* not JSON */ }
  return { version: 1, accepts: [] };
}

export interface GuardedFetchOptions {
  /** Inject a simulator for tests/bench (keeps it offline). Defaults to a live viem eth_call. */
  simulator?: (req: PaymentRequirements) => Promise<SimResult>;
  /** RPC for the default live simulator (ignored if `simulator` is provided). */
  rpcUrl?: string;
}

function deepFreeze<T extends object>(obj: T): Readonly<T> {
  Object.freeze(obj);
  Object.keys(obj).forEach((key) => {
    const prop = (obj as any)[key];
    if (prop !== null && typeof prop === 'object' && !Object.isFrozen(prop)) {
      deepFreeze(prop);
    }
  });
  return obj;
}

/**
 * Wraps a base fetch so it enforces GuardPolicy on the 402 BEFORE x402 signs.
 * Pass the result straight into wrapFetchWithPayment(guardedFetch, client).
 */
export function createGuardedFetch(
  baseFetch: typeof fetch,
  policy: GuardPolicy,
  opts: GuardedFetchOptions = {},
) {
  const frozenPolicy = deepFreeze({
    ...policy,
    allowedPayees: policy.allowedPayees ? [...policy.allowedPayees] : undefined,
  });

  // Session spend lives in this closure, never on the shared `policy` object: two guarded
  // fetches built from the same policy can't bleed budget into each other, and offline
  // suites stay deterministic instead of accumulating state across cases.
  let sessionSpent = 0n;

  const simulate =
    opts.simulator ??
    (opts.rpcUrl ? makeSimulator(opts.rpcUrl, frozenPolicy.agentAddress) : undefined);

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const res = await baseFetch(input as any, init);

    // Only gate the INITIAL 402 offer (the retry already carries the signed X-PAYMENT).
    const alreadyPaying = new Headers(init?.headers as any).has('x-payment');
    if (res.status !== 402 || alreadyPaying) return res;

    const { version, accepts } = await decodePaymentRequired(res);
    const req = accepts[0];
    if (!req) throw new AgentSecurityError('INVALID_ASSET', 'server offered no payment requirements');

    let sim: SimResult | undefined;
    if (frozenPolicy.enforceSimulation !== false) {
      if (!simulate) throw new AgentSecurityError('SIMULATION_FAILED', 'enforceSimulation set but no simulator/rpcUrl provided');
      sim = await simulate(req);
    }

    const remaining = frozenPolicy.dailyBudgetRemaining - sessionSpent;
    const decision = evaluateRequirement(req, { ...frozenPolicy, dailyBudgetRemaining: remaining }, sim);
    if (!decision.allowed) throw new AgentSecurityError(decision.code, decision.reason);

    sessionSpent += decision.amount; // commit the authorized spend to the session counter

    // Pin the offer to ONLY the requirement we validated, then hand it back. The x402
    // client reads PAYMENT-REQUIRED (header first, then a v1 body) and selects an entry
    // from `accepts[]` to sign — so returning the original multi-entry array would let a
    // server get a $1 entry approved while the client signs a $1M sibling (TOC/TOU). We
    // re-encode a single-entry offer in the header (the client's first-choice source) so
    // it can only sign what passed policy.
    const pinned = JSON.stringify({ x402Version: version, accepts: [req] });
    const headers = new Headers(res.headers);
    headers.set('payment-required', Buffer.from(pinned).toString('base64'));
    headers.delete('x-payment-required');
    headers.delete('content-length'); // let Response recompute it for the rewritten body
    headers.set('content-type', 'application/json');
    return new Response(pinned, { status: res.status, statusText: res.statusText, headers });
  };
}

/** Convenience: full guarded, payment-enabled fetch in one call. */
export function wrapFetchWithGuardedPayment(
  baseFetch: typeof fetch,
  client: x402Client,
  policy: GuardPolicy,
  opts: GuardedFetchOptions = {},
) {
  return wrapFetchWithPayment(createGuardedFetch(baseFetch, policy, opts) as typeof fetch, client);
}
