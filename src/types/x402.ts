import { parseUnits } from 'viem';

// Strict Discriminated Union prevents invalid hybrid states from existing
export type X402PaymentRequest = 
  | { kind: 'AUTHORIZE'; payee: `0x${string}`; amountStr: string; signature: `0x${string}` }
  | { kind: 'REJECT'; reason: string };

// Safely parse BigInt natively, isolating from JS Number truncation
export function parseUSDCAmount(amountStr: string): bigint {
  if (!/^\d+(\.\d{1,6})?$/.test(amountStr)) {
    throw new Error("Invalid USDC amount format: must be string representation");
  }
  // Native viem BigInt conversion (USDC uses 6 decimals)
  return parseUnits(amountStr, 6); 
}
