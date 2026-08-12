---
quick_id: 260812-hsi
type: quick
status: ready
files_modified:
  - NIP.md
---

<objective>
Clarify the NIP's `.narinfo` signature semantics without changing its publisher-endorsement model: `nixSigKey` declares only the keys endorsed by the publication, while every other syntactically valid repeatable `Sig` remains allowed and is preserved through serving and multi-source merging.
</objective>

<tasks>

<task type="auto">
  <name>Task 1: Align declaration, unsigned-cache, passthrough, and merge wording</name>
  <files>NIP.md</files>
  <action>Revise the Definitions, `nixSigKey`, unsigned-cache example, Publishing/key-rotation guidance, Consuming `.narinfo` records, Downgrade, and Presenting the cache to Nix passages as needed so they consistently distinguish publisher endorsement from the record's complete repeatable `Sig` field set. State normatively that extra syntactically valid `Sig` fields are allowed even when their keys are absent from `nixSigKey`; preserve each such field unchanged and in occurrence order when serving. Add explicit multi-source merge behavior: when compatible `.narinfo` records are merged, concatenate/pass through all source `Sig` fields rather than selecting, filtering, or dropping fields according to any publication's `nixSigKey` set. Keep signature verification against declared key bytes solely as endorsement classification, not record validity or passthrough policy. Remove wording implying that `nixSigKey` exhaustively declares every key appearing in `Sig`, that key rotation requires removal of all records carrying other signatures, or that a cache with no `nixSigKey` has no `Sig` fields. Do not weaken `.narinfo` syntax validation, Nix's independent local trust policy, or the existing event/hash verification requirements.</action>
  <verify>
    <automated>deno fmt --check NIP.md &amp;&amp; rg -n "preserved unchanged|unsigned cache|nixSigKey|concatenat|pass(ed)? through|merge" NIP.md</automated>
  </verify>
  <done>NIP.md unambiguously permits undeclared-key `Sig` fields, preserves all syntactically valid repeatable `Sig` fields unchanged, concatenates them during compatible multi-source merges, and contains no contradictory exhaustive-declaration or signature-free unsigned-cache implication.</done>
</task>

</tasks>

<verification>
Review the final NIP.md diff as one coherent normative contract: absence from `nixSigKey` changes only publisher endorsement; it never causes an otherwise syntactically valid `Sig` field to be rejected, rewritten, filtered, or lost during serving or merging. Confirm only NIP.md changed during execution.
</verification>

<success_criteria>
- Extra syntactically valid repeatable `.narinfo` `Sig` fields remain allowed regardless of `nixSigKey` membership.
- Gateways preserve every `Sig` field byte-for-byte and in occurrence order.
- Compatible records merged from multiple cache sources concatenate/pass through their `Sig` fields without declaration-based filtering.
- “Unsigned cache” means no publisher-endorsed key declaration, not absence of `.narinfo` signatures.
</success_criteria>
