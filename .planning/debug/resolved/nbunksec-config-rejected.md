---
status: resolved
trigger: "unknown config field writable.signer.nbunksec"
created: 2026-08-13
updated: 2026-08-13
---

# Configured nbunksec rejected

## Resolution

- root_cause: Runtime and CLI override types supported nbunksec, but the closed JSON and raw configuration schemas did not.
- fix: Accept and strictly validate `signer: {type: "nbunksec", nbunksec: "..."}` using Applesauce's nbunksec parser.
- verification: JSON loader/config regression and NIP-46 signer integration pass.
- files_changed: `main.ts`, `src/config/config.ts`, `tests/integration/operator_config_test.ts`, `README.md`
