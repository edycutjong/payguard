.PHONY: ci typecheck test bench security-scan

ci:
	npm run ci

typecheck:
	npx tsc --noEmit

test:
	forge test

bench:
	npm run bench

security-scan:
	@echo "=== NPM AUDIT (high+critical) ==="
	npm audit --audit-level=high || true
	@echo ""
	@echo "=== LICENSE CHECK ==="
	npx license-checker --production --failOn "GPL-3.0;AGPL-3.0" --summary || true
	@echo ""
	@echo "=== SLITHER (Solidity SAST) ==="
	slither . --exclude-dependencies || true
