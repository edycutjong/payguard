import { defineConfig } from 'tsup';

/**
 * Build the publishable npm package — the GuardianRail guard (library) and the MCP server
 * (bin). Only these two entries and their reachable graph (guardrail, simulate, rpc) are
 * emitted to dist/; the hackathon demo (server/demo/agent/probe/facilitator) is NOT shipped.
 * Runtime deps (viem, @x402/*, @modelcontextprotocol/sdk) are auto-externalized by tsup.
 */
export default defineConfig({
  entry: {
    index: 'src/index.ts', // public API → import { createGuardedFetch, ... }
    mcp: 'src/mcp.ts',     // bin → payguard-mcp (shebang preserved from source)
  },
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: false,
  target: 'node20',
  platform: 'node',
});
