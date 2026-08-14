---
quick_id: 260814-jcz
status: in_progress
---

# Check whether each Blossom blob already exists before uploading

Add a BUD-01 HEAD preflight to publication proof. A confirmed existing blob skips PUT but still undergoes the existing streamed GET/hash verification; absence uploads normally, while ambiguous preflight responses fail closed.

## Tasks

1. Extend the pinned HTTP transport with correctly framed HEAD support.
2. Preflight each publication blob and skip PUT only on HTTP 200.
3. Add fixture and integration coverage for present, absent, and hostile responses.
4. Run focused tests and the repository verification task.
