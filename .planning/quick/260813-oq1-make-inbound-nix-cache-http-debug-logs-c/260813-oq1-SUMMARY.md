---
quick_id: 260813-oq1
status: complete
commit: 18a9882
---

# Summary

Inbound request debug lines now explicitly include `direction=inbound`, a
dedicated `inboundId`, and the sanitized local listener origin including its
port. Outbound HTTP operations now use an independent `outboundId`, eliminating
false correlation between local Nix requests and remote Blossom fetches.

## Verification

- Direct namespace smoke output showed `listener=http://127.0.0.1:8787/`.
- `deno task check`
- `deno task verify`
- 23 protocol, 138 integration, and 2 stock-Nix E2E tests passed.

