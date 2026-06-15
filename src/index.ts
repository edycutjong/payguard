/**
 * PayGuard — public API surface.
 *
 * One import for everything an agent needs to make x402 spending safe. Skill consumers can
 * copy `src/` and import from "payguard" (or this barrel) instead of reaching into modules:
 *
 *   import { createGuardedFetch, evaluateRequirement } from "payguard";
 *
 * GuardianRail (the guard) is the headline; AgentVault (escrow) ships as a Solidity contract
 * under `contracts/` and is consumed via its ABI, not from this barrel.
 */
export {
  createGuardedFetch,
  wrapFetchWithGuardedPayment,
  evaluateRequirement,
  AgentSecurityError,
} from './guardrail';
export type {
  GuardPolicy,
  GuardCode,
  GuardDecision,
  GuardedFetchOptions,
  Address,
} from './guardrail';
export { makeSimulator } from './simulate';
export type { SimResult } from './simulate';
