/**
 * demo.ts — end-to-end: a GuardianRail-protected agent pays the local x402 server.
 *
 * Flow: x402Client (toClientEvmSigner) → createGuardedFetch(policy) → wrapFetchWithPayment.
 * The guard enforces budget + asset + payee + eth_call simulation BEFORE the EIP-3009
 * signature; on approval, the in-process facilitator settles 0.001 USDC on Atlantic.
 *
 * Run: start the server (`npm run server`), then `npm run demo`.
 */
import 'dotenv/config';
import { createPublicClient, type Hex, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { retryingHttp } from './rpc';
import { x402Client, wrapFetchWithPayment } from '@x402/fetch';
import { toClientEvmSigner } from '@x402/evm';
import { ExactEvmScheme } from '@x402/evm/exact/client'; // client role: createPaymentPayload
import { createGuardedFetch, AgentSecurityError, type GuardPolicy } from './guardrail';
import { atlantic, NETWORK, RPC_URL } from './facilitator';

const SERVER_URL = process.env.SERVER_URL ?? 'http://localhost:4021';
const account = privateKeyToAccount(process.env.AGENT_PK as Hex);
const usdc = process.env.USDC_ADDRESS as Address;
const receiver = process.env.RECEIVER_ADDRESS as Address;

const pub = createPublicClient({ chain: atlantic, transport: retryingHttp(RPC_URL) });

// x402 client signs EIP-3009 via the agent account.
const client = new x402Client();
client.register(NETWORK, new ExactEvmScheme(toClientEvmSigner(account, pub as any)));

// GuardianRail policy enforced before any signature.
const policy: GuardPolicy = {
  agentAddress: account.address,
  maxSpendPerCall: 5_000_000n,        // 5 USDC
  dailyBudgetRemaining: 50_000_000n,  // 50 USDC/day
  targetAsset: usdc,
  allowedPayees: [receiver],
  enforceSimulation: true,
};

const guarded = createGuardedFetch(fetch, policy, { rpcUrl: RPC_URL });
const safeFetch = wrapFetchWithPayment(guarded as typeof fetch, client);

async function main() {
  console.log(`🤖 agent ${account.address} → ${SERVER_URL}/api/data  (daily cap ${policy.dailyBudgetRemaining}, per-call max ${policy.maxSpendPerCall})`);
  try {
    const res = await safeFetch(`${SERVER_URL}/api/data`);
    const body = await res.json();
    console.log('✅ paid + received:', body);
    console.log(`💰 enforced under daily cap ${policy.dailyBudgetRemaining} / per-call max ${policy.maxSpendPerCall}`);
  } catch (e) {
    if (e instanceof AgentSecurityError) console.error(`🛑 GuardianRail BLOCKED [${e.code}]: ${e.message}`);
    else console.error('❌ request failed:', (e as any)?.shortMessage ?? (e as any)?.message ?? e);
    process.exit(1);
  }
}

main();
