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

const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
function amountOf(req: PaymentRequirements): bigint {
  return BigInt((req as any).amount ?? (req as any).maxAmountRequired);
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

async function decodePaymentRequired(res: Response): Promise<PaymentRequirements[]> {
  try {
    const body: any = await res.clone().json();
    if (body?.accepts?.length) return body.accepts as PaymentRequirements[];
  } catch { /* not JSON — try header */ }
  const hdr = res.headers.get('payment-required') ?? res.headers.get('x-payment-required');
  if (hdr) {
    try {
      const json = JSON.parse(Buffer.from(hdr, 'base64').toString('utf8'));
      if (json?.accepts?.length) return json.accepts as PaymentRequirements[];
      if (Array.isArray(json)) return json as PaymentRequirements[];
    } catch { /* ignore */ }
  }
  return [];
}

export interface GuardedFetchOptions {
  /** Inject a simulator for tests/bench (keeps it offline). Defaults to a live viem eth_call. */
  simulator?: (req: PaymentRequirements) => Promise<SimResult>;
  /** RPC for the default live simulator (ignored if `simulator` is provided). */
  rpcUrl?: string;
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
  const simulate =
    opts.simulator ??
    (opts.rpcUrl ? makeSimulator(opts.rpcUrl, policy.agentAddress) : undefined);

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const res = await baseFetch(input as any, init);

    // Only gate the INITIAL 402 offer (the retry already carries the signed X-PAYMENT).
    const alreadyPaying = new Headers(init?.headers as any).has('x-payment');
    if (res.status !== 402 || alreadyPaying) return res;

    const offered = await decodePaymentRequired(res);
    const req = offered[0];
    if (!req) throw new AgentSecurityError('INVALID_ASSET', 'server offered no payment requirements');

    let sim: SimResult | undefined;
    if (policy.enforceSimulation !== false) {
      if (!simulate) throw new AgentSecurityError('SIMULATION_FAILED', 'enforceSimulation set but no simulator/rpcUrl provided');
      sim = await simulate(req);
    }

    const decision = evaluateRequirement(req, policy, sim);
    if (!decision.allowed) throw new AgentSecurityError(decision.code, decision.reason);

    policy.dailyBudgetRemaining -= decision.amount; // commit the authorized spend
    return res; // hand the 402 back so the x402 client signs + settles
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
