/**
 * rpc.ts — a viem http transport hardened against the public Atlantic RPC.
 *
 * The Atlantic endpoint is ZAN-proxied and rate-limits by compute units, returning the
 * error "cu limit exceeded; Request too fast per second" as a JSON-RPC error inside an
 * HTTP 200 — which viem does NOT auto-retry. This transport catches that (and transient
 * "RPC Request failed") and backs off, so server/facilitator/agent flows survive bursts.
 */
import { http, type Transport, createPublicClient, fallback } from 'viem';
import { mainnet } from 'viem/chains';

export const publicClient = createPublicClient({
  chain: mainnet,
  transport: fallback([
    http(process.env.PRIMARY_RPC_URL, {
      retryCount: 5,
      retryDelay: 1000, // Enables viem's native exponential backoff calculations
      timeout: 10000,
      onFetchResponse: (response) => {
        // Intercept and log primary rate limits/errors for Datadog ingestion
        if (!response.ok || response.status === 429) {
          console.warn(JSON.stringify({
            level: 'WARN',
            event: 'rpc_degradation_detected',
            status_code: response.status,
            message: 'Primary RPC degraded. Viem initiating exponential backoff or fallback.'
          }));
        }
      }
    }),
    http(process.env.FALLBACK_RPC_URL, { 
      retryCount: 3,
      onFetchResponse: (response) => {
        // Log if the fallback RPC is also failing
        if (!response.ok || response.status === 429) {
          console.error(JSON.stringify({
            level: 'ERROR',
            event: 'fallback_rpc_degradation',
            status_code: response.status,
            message: 'Fallback RPC degraded. Critical infrastructure failing.'
          }));
        }
      }
    })
  ]),
});

export function retryingHttp(url?: string, opts: { tries?: number; delayMs?: number } = {}): Transport {
  const tries = opts.tries ?? 8;
  const delayMs = opts.delayMs ?? 2500;
  const base = http(url, { retryCount: 0 });
  return (config) => {
    const t = base(config);
    const original = t.request;
    return {
      ...t,
      request: (async (args: any) => {
        for (let i = 0; i < tries; i++) {
          try {
            return await original(args);
          } catch (e: any) {
            const m = String(e?.details ?? e?.shortMessage ?? e?.message ?? '').toLowerCase();
            const rateLimited =
              m.includes('cu limit') || m.includes('too fast') || m.includes('rate') || m.includes('request failed');
            if (!rateLimited || i === tries - 1) throw e;
            await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
          }
        }
        throw new Error('unreachable');
      }) as typeof t.request,
    };
  };
}
