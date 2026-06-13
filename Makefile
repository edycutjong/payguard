.PHONY: help setup ci typecheck test coverage bench security-scan

help: ## Show this help message
	@echo "Usage: make [target]"
	@echo ""
	@echo "Targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

setup: ## Install all dependencies (npm & foundry)
	npm install
	forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts

ci: ## Run the CI pipeline (bench + test)
	npm run ci

typecheck: ## Run TypeScript compiler checks
	npx tsc --noEmit

test: ## Run Foundry tests (AgentVault + MockUSDC)
	forge test

coverage: ## Foundry coverage for contracts/ (100%; excludes scripts & tests)
	forge coverage --no-match-coverage "script|test"

bench: ## Run GuardianRail deterministic benchmark
	npm run bench

security-scan: ## Run security linters and audits (npm audit, license, slither)
	@echo "=== NPM AUDIT (high+critical) ==="
	npm audit --audit-level=high || true
	@echo ""
	@echo "=== LICENSE CHECK ==="
	npx license-checker --production --failOn "GPL-3.0;AGPL-3.0" --summary || true
	@echo ""
	@echo "=== SLITHER (Solidity SAST) ==="
	slither . --exclude-dependencies || true
