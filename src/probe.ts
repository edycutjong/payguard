/**
 * Day-1 Settlement Probe — isolates the ONE high-risk unknown:
 *   "Can a facilitator settle an EIP-3009 transferWithAuthorization on Pharos Atlantic?"
 *
 * No x402 HTTP plumbing, no express, no facilitator server — just plain viem.
 * The agent signs the SAME TransferWithAuthorization struct that @x402/evm's
 * ExactEvmScheme uses, the facilitator submits it on-chain, we assert USDC moved.
 *
 * Prereqs:
 *   1) MockUSDC deployed by AGENT_PK (so the agent holds USDC). Set USDC_ADDRESS.
 *   2) FACILITATOR_PK funded with PHRS for gas.
 *   3) cp .env.example .env  &&  fill in keys/addresses.
 * Run: npm run probe
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import {
  createPublicClient, createWalletClient, http, defineChain,
  parseSignature, toHex, getAddress, type Address, type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const atlantic = defineChain({
  id: Number(process.env.CHAIN_ID ?? 688689),
  name: 'Pharos Atlantic Testnet',
  nativeCurrency: { name: 'PHRS', symbol: 'PHRS', decimals: 18 },
  rpcUrls: { default: { http: [process.env.RPC_URL ?? 'https://atlantic.dplabs-internal.com/'] } },
});

const usdc = getAddress(process.env.USDC_ADDRESS as Address);
const to = getAddress(process.env.RECEIVER_ADDRESS as Address);
const agent = privateKeyToAccount(process.env.AGENT_PK as Hex);
const facilitator = privateKeyToAccount(process.env.FACILITATOR_PK as Hex);

const VALUE = 1000n; // 0.001 USDC (6 decimals)

const usdcAbi = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view',
    inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'transferWithAuthorization', stateMutability: 'nonpayable',
    inputs: [
      { name: 'from', type: 'address' }, { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
      { name: 'v', type: 'uint8' }, { name: 'r', type: 'bytes32' }, { name: 's', type: 'bytes32' },
    ], outputs: [] },
] as const;

const pub = createPublicClient({ chain: atlantic, transport: http(undefined, { retryCount: 5, retryDelay: 2000 }) });
const facilitatorWallet = createWalletClient({ account: facilitator, chain: atlantic, transport: http(undefined, { retryCount: 5, retryDelay: 2000 }) });

// The public Atlantic RPC is ZAN-proxied and rate-limits by compute units / QPS
// ("cu limit exceeded; Request too fast"). Retry those transient errors with backoff.
async function withRetry<T>(fn: () => Promise<T>, label: string, tries = 6): Promise<T> {
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e: any) {
      const m = String(e?.details ?? e?.shortMessage ?? e?.message ?? '').toLowerCase();
      const rateLimited = m.includes('cu limit') || m.includes('too fast') || m.includes('rate') || m.includes('request failed');
      if (!rateLimited || i === tries - 1) throw e;
      const wait = 2500 * (i + 1);
      console.log(`  ⏳ ${label}: rate-limited, retrying in ${wait / 1000}s (${i + 1}/${tries})`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw new Error('unreachable');
}

async function main() {
  console.log(`🌐 RPC ${atlantic.rpcUrls.default.http[0]}  chain ${atlantic.id}`);
  console.log(`🪙 USDC ${usdc}\n🤖 agent ${agent.address}\n🏦 facilitator ${facilitator.address}`);

  const before = await withRetry(() => pub.readContract({ address: usdc, abi: usdcAbi, functionName: 'balanceOf', args: [to] } as any), 'balanceOf(before)') as bigint;

  // 1) Agent signs the EIP-3009 authorization (gasless for the agent).
  const validAfter = 0n;
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const nonce = toHex(randomBytes(32));

  const signature = await agent.signTypedData({
    domain: { name: 'USD Coin', version: '2', chainId: atlantic.id, verifyingContract: usdc },
    types: {
      TransferWithAuthorization: [
        { name: 'from', type: 'address' }, { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' },
        { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
      ],
    },
    primaryType: 'TransferWithAuthorization',
    message: { from: agent.address, to, value: VALUE, validAfter, validBefore, nonce },
  });

  const { r, s, v, yParity } = parseSignature(signature);
  const vByte = Number(v ?? BigInt(yParity! + 27));

  // 2) Facilitator submits on-chain (pays gas).
  console.log('\n⏳ facilitator submitting transferWithAuthorization...');
  const hash = await withRetry(() => facilitatorWallet.writeContract({
    address: usdc, abi: usdcAbi, functionName: 'transferWithAuthorization',
    args: [agent.address, to, VALUE, validAfter, validBefore, nonce, vByte, r, s],
  } as any), 'sendTransaction');
  const receipt = await withRetry(() => pub.waitForTransactionReceipt({ hash }), 'waitForReceipt');
  console.log(`📦 tx ${hash}  status=${receipt.status}  block=${receipt.blockNumber}`);

  // 3) Assert settlement.
  const after = await withRetry(() => pub.readContract({ address: usdc, abi: usdcAbi, functionName: 'balanceOf', args: [to] } as any), 'balanceOf(after)') as bigint;
  const moved = after - before;
  if (moved === VALUE && receipt.status === 'success') {
    console.log(`\n✅ SETTLED on Atlantic. Receiver +${moved} (0.001 USDC). EIP-3009 works. Green-light the x402 layer.`);
  } else {
    console.error(`\n❌ NOT settled as expected. delta=${moved} status=${receipt.status}`);
    process.exit(1);
  }
}

main().catch((e) => { console.error('❌ probe failed:', e?.shortMessage ?? e?.message ?? e); process.exit(1); });
