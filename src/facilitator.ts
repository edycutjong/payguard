/**
 * facilitator.ts — the self-hosted half of the Hybrid (Option 3) facilitator.
 *
 * x402Facilitator implements the FacilitatorClient interface (verify/settle/getSupported),
 * so the server can consume it IN-PROCESS — no HTTP-facilitator routing to stand up.
 * It settles EIP-3009 transferWithAuthorization on Atlantic using the FACILITATOR_PK signer.
 */
import 'dotenv/config';
import { createWalletClient, publicActions, defineChain, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { retryingHttp } from './rpc';
import { x402Facilitator } from '@x402/core/facilitator';
import { toFacilitatorEvmSigner } from '@x402/evm';
import { ExactEvmScheme } from '@x402/evm/exact/facilitator'; // facilitator role: getExtra/verify/settle

export const NETWORK = 'eip155:688689' as const;
export const RPC_URL = process.env.RPC_URL ?? 'https://atlantic.dplabs-internal.com/';

export const atlantic = defineChain({
  id: Number(process.env.CHAIN_ID ?? 688689),
  name: 'Pharos Atlantic Testnet',
  nativeCurrency: { name: 'PHRS', symbol: 'PHRS', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});

/** In-process facilitator that settles on-chain with the FACILITATOR_PK (must hold PHRS for gas). */
export function buildLocalFacilitator(): x402Facilitator {
  const account = privateKeyToAccount(process.env.FACILITATOR_PK as Hex);

  // A wallet client extended with publicActions exposes the full method set
  // toFacilitatorEvmSigner needs: writeContract (settle), readContract + verifyTypedData (verify).
  const client = createWalletClient({ account, chain: atlantic, transport: retryingHttp(RPC_URL) })
    .extend(publicActions);

  const signer = toFacilitatorEvmSigner(
    Object.assign(client, { address: account.address }) as any,
  );

  const facilitator = new x402Facilitator();
  facilitator.register(NETWORK, new ExactEvmScheme(signer));
  // Surface why a payment was rejected (otherwise the server just re-challenges with 402).
  const anyf = facilitator as any;
  anyf.onVerifyFailure?.(async (ctx: any) => console.error('[facilitator] VERIFY failed:', ctx?.error?.message ?? ctx?.reason ?? JSON.stringify(ctx)?.slice(0, 400)));
  anyf.onSettleFailure?.(async (ctx: any) => console.error('[facilitator] SETTLE failed:', ctx?.error?.message ?? ctx?.reason ?? JSON.stringify(ctx)?.slice(0, 400)));
  return facilitator;
}
