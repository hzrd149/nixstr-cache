---
quick_id: 260814-kfd
status: in_progress
---

# Add bounded Blossom upload progress logging

Emit secret-safe operator lines when each server worker starts and after the first and every tenth processed blob. Preserve the existing final success/failure summaries and avoid per-blob console spam.

## Tasks

1. Add a closed replica-progress diagnostic event.
2. Emit bounded progress from initial and repair server workers.
3. Render sanitized console and DEBUG output.
4. Add diagnostic and coordinator coverage, then run verification.
