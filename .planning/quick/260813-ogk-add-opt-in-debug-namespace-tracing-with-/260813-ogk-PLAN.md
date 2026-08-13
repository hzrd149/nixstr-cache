---
quick_id: 260813-ogk
status: in_progress
---

# Add opt-in HTTP debug tracing

## Goal

Use `@grammyjs/debug` so `DEBUG=nixstr:http:*` (or `DEBUG=*`) reveals inbound
HTTP request lifecycles, routing decisions, and outbound HTTP attempts while
normal operation remains unchanged.

## Tasks

1. Add the exact JSR dependency and a project-owned, secret-safe debug facade.
2. Trace inbound request start, route/decision milestones, errors, and completion
   with correlation IDs.
3. Trace outbound safe-fetch attempts, responses, and redirects without logging
   credentials, query strings, headers, or bodies.
4. Document namespaces, test sanitization and disabled-by-default behavior, then
   run full verification and commit atomically.

