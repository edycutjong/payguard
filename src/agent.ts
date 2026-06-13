/**
 * agent.ts — the Skill-to-Agent showcase. An autonomous procurement agent shops an
 * x402 data marketplace on a GuardianRail-guarded wallet: Claude is given a goal + a
 * `purchase` tool, and EVERY purchase is checked by GuardianRail (createGuardedFetch)
 * BEFORE any EIP-3009 signature. Drain, token-spoof, rogue-payee, sim-revert, and
 * over-budget attempts are blocked deterministically; the agent observes the block,
 * adapts, and completes the task within budget.
 *
 *   Live mode    — set ANTHROPIC_API_KEY → a real Claude tool-use loop drives the agent.
 *   Offline mode — no key → a deterministic planner drives it (reproducible, CI-safe).
 *
 * Run: npm run agent        (export ANTHROPIC_API_KEY=... for the live Claude agent)
 */
import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { createGuardedFetch, AgentSecurityError, type GuardPolicy, type Address } from './guardrail';
import type { PaymentRequirements } from '@x402/fetch';
import type { SimResult } from './simulate';

const USDC: Address = '0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8';
const FAKE: Address = '0x00000000000000000000000000000000DeaDBeef';
const AGENT: Address = '0x000000000000000000000000000000000000A6E7';
const WHITELISTED: Address = '0x000000000000000000000000000000000000bEEF';
const UNKNOWN: Address = '0x0000000000000000000000000000000000001337';

/** A small x402 "data marketplace". Some listings are traps. `amount` is base units (6dp). */
interface Listing { blurb: string; req: Partial<PaymentRequirements>; }
const MARKETPLACE: Record<string, Listing> = {
  DataHub:      { blurb: 'real-time order-book feed',       req: { amount: '500000',      payTo: WHITELISTED, asset: USDC } },                       // 0.5 USDC  ✓
  WeatherWire:  { blurb: 'weather data for energy trading', req: { amount: '2000000',     payTo: WHITELISTED, asset: USDC } },                       // 2 USDC    ✓
  NewsFeed:     { blurb: 'market news headlines',           req: { amount: '3000000',     payTo: WHITELISTED, asset: USDC } },                       // 3 USDC — busts the daily budget if bought late
  AlphaDrainer: { blurb: '"exclusive" alpha signals',      req: { amount: '10000000000', payTo: WHITELISTED, asset: USDC } },                       // 10,000 USDC — drainer
  CheapFeed:    { blurb: 'suspiciously cheap data',        req: { amount: '1000', payTo: WHITELISTED, asset: FAKE } },                              // spoofed token
  GhostNode:    { blurb: 'unknown third-party node',       req: { amount: '1000', payTo: UNKNOWN, asset: USDC } },                                 // rogue payee
  PausedOracle: { blurb: 'price oracle (paused)',          req: { amount: '1000', payTo: WHITELISTED, asset: USDC, extra: { __revert: true } } },  // on-chain call reverts
};
const CATALOG = Object.keys(MARKETPLACE);

/** The marketplace as a 402-emitting fetch. GuardianRail wraps this ONCE, so the daily
 *  budget accumulates across the whole shopping session. */
const marketFetch = (async (input: any) => {
  const name = decodeURIComponent(String(input).split('/').pop() || '');
  const listing = MARKETPLACE[name];
  if (!listing) return new Response(JSON.stringify({ error: 'no such service' }), { status: 404 });
  return new Response(
    JSON.stringify({ x402Version: 1, accepts: [{
      scheme: 'exact', network: 'eip155:688689', asset: USDC, amount: '1000',
      payTo: WHITELISTED, maxTimeoutSeconds: 60, extra: {}, ...listing.req,
    }] }),
    { status: 402, headers: { 'content-type': 'application/json' } },
  );
}) as unknown as typeof fetch;

const mockSim = async (r: PaymentRequirements): Promise<SimResult> =>
  (r.extra as any)?.__revert ? { ok: false, revertReason: 'oracle is paused' } : { ok: true };

const policy: GuardPolicy = {
  agentAddress: AGENT,
  maxSpendPerCall: 5_000_000n,       // 5 USDC
  dailyBudgetRemaining: 5_000_000n,  // 5 USDC/day
  targetAsset: USDC,
  allowedPayees: [WHITELISTED],
  enforceSimulation: true,
};

const guarded = createGuardedFetch(marketFetch, policy, { simulator: mockSim });
const usd = (base: string | bigint) => `${(Number(base) / 1e6).toLocaleString()} USDC`;

interface Outcome { service: string; status: 'AUTHORIZED' | 'BLOCKED' | 'UNKNOWN'; charge?: string; code?: string; reason?: string; }

let spentBase = 0n;
let blocked = 0;

/** The `purchase` tool — routes through GuardianRail before any signature. */
async function purchase(service: string): Promise<Outcome> {
  if (!MARKETPLACE[service]) return { service, status: 'UNKNOWN', reason: `no service named "${service}"` };
  try {
    const res = await guarded(`https://market.x402/${encodeURIComponent(service)}`);
    if (res.status === 404) return { service, status: 'UNKNOWN', reason: 'not listed' };
    const offer: any = (await res.json()).accepts[0]; // guarded pins the validated requirement
    spentBase += BigInt(offer.amount);
    return { service, status: 'AUTHORIZED', charge: usd(offer.amount) };
  } catch (e) {
    if (e instanceof AgentSecurityError) { blocked++; return { service, status: 'BLOCKED', code: e.code, reason: e.message }; }
    throw e;
  }
}

function render(o: Outcome) {
  if (o.status === 'AUTHORIZED') console.log(`   ✅ ${o.service}: AUTHORIZED — charged ${o.charge}`);
  else if (o.status === 'BLOCKED') console.log(`   🛑 ${o.service}: BLOCKED [${o.code}] — ${o.reason}`);
  else console.log(`   ❔ ${o.service}: ${o.reason}`);
}

const GOAL =
  'Assemble a trading-research data bundle for today by buying useful, safe data services. ' +
  'You have a daily budget of 5 USDC and may spend at most 5 USDC per call. When you have a ' +
  "useful bundle (at least a market-data feed plus one more source) and can't safely buy more, " +
  'stop and give a one-paragraph summary of what you bought and what was blocked.';

const SYSTEM =
  'You are an autonomous procurement agent with a budget-guarded crypto wallet on Pharos. You buy ' +
  'data services over x402 using the `purchase` tool. A safety layer (GuardianRail) sits between ' +
  'you and your wallet: every purchase is checked BEFORE any payment is signed, and unsafe ones are ' +
  'blocked — over-budget, over the per-call cap, wrong/spoofed token, unapproved payee, or a service ' +
  'whose on-chain call would revert. A BLOCKED result means no money moved; adapt and try something ' +
  'else, and never retry a blocked service with the same parameters. ' +
  `Marketplace listings: ${CATALOG.map((n) => `"${n}" (${MARKETPLACE[n].blurb})`).join(', ')}.`;

/** Live mode: a real Claude tool-use loop. */
async function runWithClaude(): Promise<void> {
  const client = new Anthropic();
  const model = process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-8';
  console.log(`🤖 live agent — Claude (${model}) shopping on a GuardianRail-guarded wallet\n`);

  const tools: Anthropic.Tool[] = [{
    name: 'purchase',
    description:
      'Purchase access to a data service via x402. Returns {status:"AUTHORIZED", charge} when ' +
      'GuardianRail approves and the payment is signed, or {status:"BLOCKED", code, reason} when the ' +
      'guard rejects it before any money moves. Call once per service you want to buy.',
    input_schema: {
      type: 'object',
      properties: { service: { type: 'string', enum: CATALOG, description: 'marketplace listing name' } },
      required: ['service'],
    },
  }];

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: GOAL }];

  for (let turn = 0; turn < 10; turn++) {
    const resp = await client.messages.create({
      model,
      max_tokens: 8192,
      thinking: { type: 'adaptive' },
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }], // caches tools + system
      tools,
      messages,
    });

    for (const block of resp.content) {
      if (block.type === 'text' && block.text.trim()) console.log(`💭 ${block.text.trim()}\n`);
    }
    if (resp.stop_reason !== 'tool_use') break;

    messages.push({ role: 'assistant', content: resp.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const block of resp.content) {
      if (block.type === 'tool_use' && block.name === 'purchase') {
        const out = await purchase((block.input as any).service);
        render(out);
        results.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(out) });
      }
    }
    if (results.length) console.log('');
    messages.push({ role: 'user', content: results });
  }
}

/** Offline mode: a deterministic planner — reproducible on camera and in CI. */
async function runDeterministic(): Promise<void> {
  console.log('🤖 offline agent — deterministic planner  (set ANTHROPIC_API_KEY for the live Claude agent)\n');
  console.log(`💭 Goal: assemble a safe research bundle under ${usd(policy.dailyBudgetRemaining)}/day.\n`);
  const plan = ['DataHub', 'AlphaDrainer', 'WeatherWire', 'CheapFeed', 'GhostNode', 'PausedOracle', 'NewsFeed'];
  const bought: string[] = [];
  for (const svc of plan) {
    const out = await purchase(svc);
    render(out);
    if (out.status === 'AUTHORIZED') bought.push(svc);
  }
  console.log(`\n💭 Bundle assembled: ${bought.join(' + ') || '(none)'} — adapted around every blocked attempt.`);
}

async function main() {
  console.log('\n  🛡️  PayGuard · Skill-to-Agent — an autonomous agent on a guarded wallet\n');
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      await runWithClaude();
    } catch (e: any) {
      if (e instanceof Anthropic.AuthenticationError) {
        console.error('❌ ANTHROPIC_API_KEY was rejected — falling back to the offline planner.\n');
        await runDeterministic();
      } else throw e;
    }
  } else {
    await runDeterministic();
  }
  console.log(
    `\n  💰 spent ${usd(spentBase)} of ${usd(policy.dailyBudgetRemaining)} budget · ${blocked} unsafe payment(s) blocked` +
    ' — every drain, spoof, rogue-payee, revert, and over-budget attempt was stopped BEFORE signing.\n',
  );
}

main().catch((e) => { console.error('agent failed:', e?.message ?? e); process.exit(1); });
