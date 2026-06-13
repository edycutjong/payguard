/**
 * simulate.ts — shared read-only pre-flight (the core GuardianRail + AgentVault both use).
 * eth_call's the USDC transfer the agent is about to authorize; reverts (insufficient
 * balance, blacklist, non-contract asset) surface BEFORE any signature is produced.
 * Pure read path — never sends a transaction, never needs a funded key.
 */
import { createPublicClient, getAddress, type Address } from 'viem';
import type { PaymentRequirements } from '@x402/fetch';
import { retryingHttp } from './rpc';

export interface SimResult { ok: boolean; revertReason?: string; }

const erc20Abi = [
  { type: 'function', name: 'transfer', stateMutability: 'nonpayable',
    inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view',
    inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;

/**
 * Returns an injectable simulator for wrapFetchWithGuardedPayment({ simulator }).
 * @param agent the address that would sign/fund the payment (the from of the transfer)
 */
export function makeSimulator(rpcUrl: string, agent: Address) {
  const pub = createPublicClient({ transport: retryingHttp(rpcUrl) });

  return async (req: PaymentRequirements): Promise<SimResult> => {
    try {
      const asset = getAddress(req.asset as Address);
      const code = await pub.getCode({ address: asset });
      if (!code || code === '0x') return { ok: false, revertReason: 'asset has no contract code' };

      const amount = BigInt((req as any).amount ?? (req as any).maxAmountRequired);
      // eth_call the transfer as the agent — reverts on insufficient balance / blacklist.
      await pub.simulateContract({
        address: asset, abi: erc20Abi, functionName: 'transfer',
        args: [getAddress(req.payTo as Address), amount], account: agent,
      });
      return { ok: true };
    } catch (e: any) {
      return { ok: false, revertReason: e?.shortMessage ?? e?.message ?? 'revert' };
    }
  };
}
