---
quick_id: 260813-lgb
type: quick
status: ready
autonomous: true
commit: false
---

# CLI signer overrides with pre-bind ncryptsec unlocking

Add `--signer` support for strict nsec, ncryptsec, and nbunksec inputs. Merge the
CLI signer over JSON/environment signer configuration while retaining all other
enabled writable policy. Use Applesauce signer constructors for each form.

Make daemon launch asynchronous. An effective ncryptsec signer must unlock,
derive its pubkey, and bind durable ownership before the HTTP listener starts.
Interactive wrong passwords retry until cancellation; non-TTY input gets one
attempt. Any preflight failure disposes initialized resources and never binds.
Other signer modes retain their existing readiness behavior.

Test CLI syntax and sanitization, override precedence, each signer form,
pre-bind waiting/retry/failure cleanup, and the unchanged asynchronous nbunksec
path. Update operator documentation and run all repository gates possible in
the shared dirty worktree.
