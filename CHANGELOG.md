# Changelog

## [0.2.0](https://github.com/edycutjong/payguard/compare/payguard-v0.1.5...payguard-v0.2.0) (2026-07-08)


### Features

* **agent:** autonomous Claude agent on a GuardianRail-guarded wallet (Skill-to-Agent) ([da2ae39](https://github.com/edycutjong/payguard/commit/da2ae39c690dc40e7cec491c81cd2cd1b7b1eeb4))
* **api:** public barrel (src/index.ts) + 3-way compose docs ([a7c164c](https://github.com/edycutjong/payguard/commit/a7c164c0e5e035d7bddef752fcc2b701f3cd2b9d))
* **contracts:** AgentVault conditional escrow + MockUSDC EIP-3009 + deploy script ([489cb98](https://github.com/edycutjong/payguard/commit/489cb9806a3fc9dab47ab43081b8b3067a12135e))
* enhance PayGuard project structure, add MockUSDC tests, and update documentation ([46bfe26](https://github.com/edycutjong/payguard/commit/46bfe262b4376edc62445a11429c2b8a22211560))
* **guardrail:** GuardianRail pre-flight interceptor + eth_call simulator + rate-limit transport ([0ca60dd](https://github.com/edycutjong/payguard/commit/0ca60dd9a7f4e32a7f8e0e054ec1965ef9829721))
* **mcp:** expose GuardianRail as an MCP server ([9a3940b](https://github.com/edycutjong/payguard/commit/9a3940b0fa42975a6985c3cf77e7bcea5f194aaf))
* **x402:** hybrid in-process facilitator, resource server, settlement probe, guarded demo ([846a0cd](https://github.com/edycutjong/payguard/commit/846a0cd89936e8f8753bb3d90b9829934c570a8d))


### Bug Fixes

* **contracts:** strictly enforce CEI and prevent EIP-3009 signature replay ([523cae6](https://github.com/edycutjong/payguard/commit/523cae6556c2a11aabdd545e791608a61af35365))
* **security:** resolve TOCTOU header spoofing, EIP-3009 routing, and V8 DoS ([abeb324](https://github.com/edycutjong/payguard/commit/abeb32402e403eddf64e9561c6f06944f2cfd768))
* upgrade dependencies and automate SemVer releases ([a9919c6](https://github.com/edycutjong/payguard/commit/a9919c6b3986ee453903bf1a4b6f6c2ffb56b220))


### Performance

* **rpc:** configure viem fallback transport with exponential backoff ([cfd5f59](https://github.com/edycutjong/payguard/commit/cfd5f59c533f51d3a7969494f943606bb7bab41d))
