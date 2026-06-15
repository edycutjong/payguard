/**
 * mcp.ts — GuardianRail as a Model Context Protocol (MCP) server.
 *
 * Exposes the *shipped* guard brain (`evaluateRequirement`, unchanged) as MCP tools so ANY
 * MCP-capable agent — Claude Desktop, Cursor, a custom runtime — can ask "is this x402
 * payment safe?" before signing, with zero PayGuard-specific code. This is the same pure
 * policy core the attack bench and the live `createGuardedFetch` use; the MCP layer is a
 * thin transport, not a reimplementation.
 *
 * Tools:
 *   • evaluate_payment — run a 402 offer (asset, amount, payTo) against the guard policy.
 *   • get_policy       — introspect the active operator policy.
 *
 * Policy is operator-controlled via env (so the agent can't widen its own limits), with
 * optional per-call tightening. Run: `npm run mcp` (speaks MCP over stdio).
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  evaluateRequirement,
  AgentSecurityError,
  type GuardPolicy,
  type Address,
  type GuardCode,
} from './guardrail';
import type { PaymentRequirements } from '@x402/fetch';
import type { SimResult } from './simulate';

// MockUSDC on Pharos Atlantic — the canonical asset the demo settles in.
const DEFAULT_USDC = '0xe54205649D6d41Aa9cCdD5667eaDB62f1dFA84AC' as Address;

/** Operator policy from env — the agent cannot widen these at call time, only tighten. */
function basePolicy(): GuardPolicy {
  const csv = (process.env.PAYGUARD_ALLOWED_PAYEES ?? '').trim();
  return {
    agentAddress: (process.env.PAYGUARD_AGENT_ADDRESS ?? '0x0000000000000000000000000000000000000000') as Address,
    maxSpendPerCall: BigInt(process.env.PAYGUARD_MAX_SPEND ?? '5000000'),       // 5 USDC
    dailyBudgetRemaining: BigInt(process.env.PAYGUARD_DAILY_BUDGET ?? '50000000'), // 50 USDC
    targetAsset: (process.env.PAYGUARD_TARGET_ASSET ?? DEFAULT_USDC) as Address,
    allowedPayees: csv ? (csv.split(',').map((s) => s.trim()) as Address[]) : undefined,
    enforceSimulation: false, // the MCP layer is transport-only; callers pass simulationOk if they ran an eth_call
  };
}

const server = new Server(
  { name: 'payguard-guardianrail', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'evaluate_payment',
      description:
        "GuardianRail safety check for an x402 '402 PAYMENT-REQUIRED' offer. Call BEFORE signing " +
        'any EIP-3009 authorization. Returns { allowed, code, reason }: blocks token-spoofing, ' +
        'over-cap / over-budget spends, unapproved payees, and (when simulationOk=false) reverts.',
      inputSchema: {
        type: 'object',
        properties: {
          asset: { type: 'string', description: 'Asset (token) address the server wants to be paid in.' },
          amount: { type: 'string', description: 'Amount in base units (USDC = 6 decimals), as a string.' },
          payTo: { type: 'string', description: 'Payee address the server wants funds sent to.' },
          simulationOk: { type: 'boolean', description: 'Optional: result of an eth_call dry-run. false ⇒ SIMULATION_FAILED.' },
          maxSpendPerCall: { type: 'string', description: 'Optional per-call tightening of the spend cap (base units).' },
          dailyBudgetRemaining: { type: 'string', description: 'Optional per-call tightening of remaining daily budget (base units).' },
        },
        required: ['asset', 'amount', 'payTo'],
      },
    },
    {
      name: 'get_policy',
      description: 'Return the active operator-configured GuardianRail policy (limits, target asset, allowlist).',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
}));

const json = (obj: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(obj, null, 2) }] });

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  const a = args as Record<string, unknown>;

  if (name === 'get_policy') {
    const p = basePolicy();
    return json({
      maxSpendPerCall: p.maxSpendPerCall.toString(),
      dailyBudgetRemaining: p.dailyBudgetRemaining.toString(),
      targetAsset: p.targetAsset,
      allowedPayees: p.allowedPayees ?? 'any',
      enforceSimulation: p.enforceSimulation ?? true,
    });
  }

  if (name === 'evaluate_payment') {
    // Start from the operator policy; allow per-call TIGHTENING only (never widening).
    const p = basePolicy();
    if (typeof a.maxSpendPerCall === 'string')
      p.maxSpendPerCall = bigMin(p.maxSpendPerCall, BigInt(a.maxSpendPerCall));
    if (typeof a.dailyBudgetRemaining === 'string')
      p.dailyBudgetRemaining = bigMin(p.dailyBudgetRemaining, BigInt(a.dailyBudgetRemaining));

    const req = {
      scheme: 'exact', network: 'eip155:688689',
      asset: String(a.asset), amount: String(a.amount), payTo: String(a.payTo),
      maxTimeoutSeconds: 60, extra: {},
    } as unknown as PaymentRequirements;

    const sim: SimResult | undefined =
      a.simulationOk === undefined ? undefined : { ok: Boolean(a.simulationOk) };
    const enforced: GuardPolicy = { ...p, enforceSimulation: sim !== undefined };

    try {
      const d = evaluateRequirement(req, enforced, sim);
      return json({ allowed: d.allowed, code: d.code, reason: d.reason, amount: d.amount.toString() });
    } catch (e) {
      // A malformed/hostile amount throws AgentSecurityError — surface it as a BLOCKED decision,
      // not a transport error: "blocked" is a normal, expected outcome for a guard.
      if (e instanceof AgentSecurityError)
        return json({ allowed: false, code: e.code as GuardCode, reason: e.message });
      throw e;
    }
  }

  throw new Error(`unknown tool: ${name}`);
});

const bigMin = (x: bigint, y: bigint) => (x < y ? x : y);

async function main() {
  await server.connect(new StdioServerTransport());
  // Banner goes to stderr so it never corrupts the stdio JSON-RPC stream on stdout.
  console.error('🛡️  PayGuard GuardianRail MCP server ready (stdio) — tools: evaluate_payment, get_policy');
}

main().catch((err) => {
  console.error('MCP server fatal:', err);
  process.exit(1);
});
