/**
 * server.ts — an x402-protected resource server on Pharos Atlantic.
 *
 * Hybrid facilitator: uses the official Pharos FACILITATOR_URL when set, otherwise the
 * in-process self-hosted x402Facilitator (no external dependency). The protected route
 * charges 0.001 USDC via the x402 "exact" EIP-3009 scheme.
 */
import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import { x402ResourceServer, paymentMiddleware } from '@x402/express';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { ExactEvmScheme } from '@x402/evm/exact/server'; // server role: registerMoneyParser/parsePrice
import { buildLocalFacilitator, NETWORK, RPC_URL } from './facilitator';

const PORT = Number(process.env.PORT ?? 4021);
const payTo = process.env.RECEIVER_ADDRESS as `0x${string}`;
const usdc = process.env.USDC_ADDRESS as `0x${string}`;
if (!payTo || !usdc) { console.error('Set RECEIVER_ADDRESS and USDC_ADDRESS'); process.exit(1); }

// Hybrid (Option 3): official facilitator URL if provided, else self-hosted in-process.
const facilitatorClient = process.env.FACILITATOR_URL
  ? new HTTPFacilitatorClient({ url: process.env.FACILITATOR_URL })
  : buildLocalFacilitator();

const resourceServer = new x402ResourceServer(facilitatorClient as any);

// Register the EVM "exact" scheme + map the canonical Pharos USDC (6dp, EIP-712 version "2").
const evmScheme = new ExactEvmScheme();
evmScheme.registerMoneyParser(async (amount: number, network: string) => {
  if (network !== NETWORK) return null;
  // extra.name MUST equal the token's EIP-712 domain name (MockUSDC = "USD Coin"), not its symbol.
  return { amount: (amount * 1e6).toString(), asset: usdc, extra: { name: 'USD Coin', version: '2' } };
});
resourceServer.register(NETWORK, evmScheme);

const app = express();
app.use(express.json());

app.use(
  paymentMiddleware(
    {
      'GET /api/data': {
        accepts: { scheme: 'exact', price: '0.001', network: NETWORK, payTo },
        description: 'PayGuard demo data service',
        mimeType: 'application/json',
      },
    },
    resourceServer,
  ),
);

app.get('/health', (_req, res) => res.json({ ok: true, network: NETWORK, rpc: RPC_URL, payTo }));
app.get('/api/data', (_req, res) =>
  res.json({ secret: 'PayGuard: safe x402 payment settled on Pharos Atlantic.', ts: Date.now() }),
);

// Async Error Boundary ensures Express never blocks or crashes on Promise rejections
export const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) => 
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch((error) => {
      // Sanitize log to prevent leaking sensitive env state (e.g. PRIVATE_KEY)
      console.error("GuardianRail Intercept Error:", error.message); 
      res.status(500).json({ error: "Internal Server Error during simulation" });
    });
  };

app.post('/api/v1/intercept', asyncHandler(async (req, res) => {
  // Safe asynchronous simulation and pre-flight validation...
  res.json({ ok: true });
}));

app.listen(PORT, () => console.log(`🚀 PayGuard server on http://localhost:${PORT}  (facilitator: ${process.env.FACILITATOR_URL ? 'remote' : 'self-hosted in-process'})`));
