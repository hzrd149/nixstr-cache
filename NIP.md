# NIP-XX: Nix Cache Hashtree Roots

`draft` `optional`

This NIP defines how a Nostr pubkey publishes the current Hashtree root of a
Nix binary cache.

It does not define the Hashtree encoding, how Nix store objects are inserted
into that tree, or how the resulting cache is presented to Nix. Hashtree
manifests and references are defined by [BUD-18][].

The key words MUST, MUST NOT, REQUIRED, SHOULD, SHOULD NOT, RECOMMENDED, MAY,
and OPTIONAL are to be interpreted as described in [RFC 2119][] and [RFC 8174][]
when, and only when, they appear in all capitals.

## Motivation

A published Nix binary cache is represented by an immutable Hashtree. Each
cache update publishes a new root. Nostr provides signed, mutable pointers from
a publisher's pubkey to either its default cache or a publisher-chosen named
cache.

The Nostr signature authenticates who announced the root. The Hashtree root
authenticates the tree reachable from it.

## Definitions

**Blob** — a byte string held by a Blossom server and retrieved by the SHA-256
of its bytes, per [BUD-01][].

**Hashtree** — the content-addressed manifest DAG defined by [BUD-16][],
[BUD-17][], and [BUD-18][]. Every node and leaf in it is a blob.

**Root manifest** — the [BUD-16][] directory manifest that an event's `htree`
reference resolves to, and the entry point to a published cache.

**Self-encrypted Hashtree** — a Hashtree whose blobs are encrypted per
[BUD-15][], referenced by an `nhash` that carries the root decryption key.

**Store object** — a Nix store path together with its metadata, serialized for
publication as a [`.narinfo`][] record and a [NAR][] archive per the
[Nix binary cache][] layout.

**Publication event** — a kind `17091` or `37091` event conforming to this NIP.

**Publisher** — the Nostr pubkey that signs a publication event.

**Cache identity** — the `(kind, pubkey)` or `(kind, pubkey, d)` tuple given in
the Event kinds table below. Successive events sharing an identity are
successive states of one cache, which is what makes rollback between them
meaningful.

**Unsigned cache** — a cache whose publication event declares no `nixSigKey`
tag.

**Client** — any implementation that resolves a publication event and fetches
from the Hashtree it references.

**Gateway** — a client that does so on behalf of a Nix client that cannot,
whatever store type it presents to that Nix client. A gateway issues requests
from its own host rather than the requesting user's, which is why several
requirements below single it out.

## Event kinds

This NIP defines two event kinds dedicated to Nix cache publication:

| Kind    | Type        | Use                       | Identity             |
| ------- | ----------- | ------------------------- | -------------------- |
| `17091` | replaceable | publisher's default cache | `(17091, pubkey)`    |
| `37091` | addressable | named cache               | `(37091, pubkey, d)` |

These dedicated kinds distinguish Nix cache roots from unrelated Hashtrees
published by the same pubkey.

Kind `17091` publishes at most one default cache per pubkey, identified by:

```text
17091:<publisher-pubkey>:
```

Kind `37091` publishes any number of named caches under a pubkey, identified by:

```text
37091:<publisher-pubkey>:<name>
```

`<publisher-pubkey>` is the event author's 32-byte lowercase hexadecimal Nostr
public key. `<name>` MUST be a non-empty string. Cache names are scoped to the
publisher and need not be globally unique. Publishers SHOULD use short,
human-readable names such as `nixpkgs-unstable` or `my-overlay`.

## Tags

This NIP defines the `d`, `htree`, `nixSigKey`, and `blossom` tags. Tags not
defined by this NIP MAY be included and MUST be ignored by clients that do not
understand them.

### `d`

```json
["d", "<name>"]
```

Kind `37091` events MUST contain exactly one `d` tag; kind `17091` events MUST
NOT contain one. The value is the non-empty cache name described in the Event
kinds section. It MUST NOT have an application or protocol prefix; the dedicated
event kind already identifies it as a Nix cache name.

Names are compared as raw bytes. Clients MUST NOT apply Unicode normalization or
case folding before comparing: two names that differ by a single byte are two
different caches, even where they render identically. Publishers SHOULD restrict
names to `[a-z0-9._-]` so that a displayed name is unambiguous.

### `htree`

The `htree` tag has this form:

```json
["htree", "htree://<nhash>"]
```

The URI MUST use [BUD-18][]'s immutable `nhash` form and MUST resolve to the
root directory manifest. It MUST NOT contain a path, query string, or fragment.

This is deliberately stricter than [BUD-18][], which also defines a mutable
`htree://<npub>/<tree-name>` form and permits paths. The mutable form would
place a second, unauthenticated indirection between the signed event and the
tree, so the event signature would no longer bind the publisher to one specific
tree state — which is what this NIP exists to do. A path would resolve to
something other than the root.

The `nhash` payload MUST be TLV-encoded. It MUST contain exactly one type `0`
record holding the 32-byte root manifest hash, and MAY contain at most one type
`5` record holding the 32-byte client-side root decryption key. Clients MUST
reject any other TLV type, including the types [BUD-18][] reserves for future
use, and MUST reject the legacy bare-32-byte payload form. [BUD-18][] tolerates
both for forward compatibility; this NIP does not, because a root reference that
two implementations decode differently would silently point them at different
caches.

For a plaintext Hashtree, the `nhash` MUST omit the type `5` key. For a
self-encrypted Hashtree, it MUST include the key needed to decrypt the root
manifest. Child manifests and blobs are decrypted according to [BUD-15][] and
the [BUD-16][] and [BUD-17][] Hashtree manifest rules.

Publishing either form makes the Hashtree publicly accessible. See Trust and
Security for the implications of self-encryption.

Events of either kind MUST contain exactly one `htree` tag.

### `nixSigKey`

Each `nixSigKey` tag has this form:

```json
["nixSigKey", "<key-name>:<base64-ed25519-public-key>"]
```

The value is a Nix public key in the format Nix itself accepts, so that it can
be copied verbatim into `trusted-public-keys`. It MUST contain exactly one
colon. The part before the colon is the key name: non-empty, at most 64 bytes,
and free of whitespace and control characters. The part after it is the base64
encoding of the Ed25519 public-key bytes; it MUST be 44 characters of the
standard base64 alphabet with a single `=` pad, MUST decode to exactly 32 bytes,
and MUST be canonical, meaning that re-encoding the decoded bytes reproduces the
original string. Non-canonical encodings are rejected so that two clients cannot
derive different key sets from the same event.

A key is identified by its decoded 32 bytes, never by its name. Clients MUST
match `.narinfo` signatures on those bytes and MUST NOT use the name to select,
authorize, or reject a key. Nix key names commonly resemble domains, but a
Nostr-published cache is not bound to a serving domain and can be served by any
Blossom server or a local gateway; the name is a label carried for
configuration, not an identity claim.

When present, the set of `nixSigKey` tags declares every Nix signing key that a
publisher expects clients to accept for `.narinfo` records in this cache. A
cache MAY use multiple keys, for example during key rotation or when combining
artifacts from multiple builders. Clients MUST ignore duplicate tags whose
values decode to the same 32 bytes, whatever names those tags carry.

A publisher MUST NOT declare two keys with different bytes under the same name.
Nix indexes `trusted-public-keys` by name, so a repeated name is unrepresentable
in a Nix configuration and one of the two keys would be silently dropped.

`nixSigKey` tags are optional. Events without them use the unsigned-cache rules
defined in Resolution.

### `blossom`

Each `blossom` tag has this form:

```json
["blossom", "<server-url>"]
```

Events MAY contain one or more `blossom` tags naming servers from which the root
manifest and referenced blobs can be fetched, ordered by publisher preference.

These tags are a hint, not a restriction. Because every blob is
content-addressed, the source a client fetches from carries no trust, and a
client is free to resolve blobs however it likes; see Resolution. The tags say
where the publisher put the blobs, which makes them the best first guess and
nothing more.

Each value MUST be an absolute HTTP or HTTPS URL and MUST NOT contain a userinfo
component. Publishers SHOULD omit a trailing slash. Clients MUST remove trailing
slashes before appending `/<sha256>` to form the blob URL; any path prefix in
the value is preserved.

A `blossom` tag that fails these requirements MUST be ignored and does not
invalidate the event. Because these URLs are chosen by the publisher and fetched
by the client, clients MUST also apply the request restrictions in Resolution.

## Content

The event `content` MAY contain a human-readable description of the cache. An
empty string indicates no description. Clients MUST use the `htree` tag as the
root reference and MUST NOT interpret `content` as protocol data. `content` is
publisher-supplied text: clients that display it MUST treat it as untrusted and
MUST NOT interpret markup or control sequences in it.

## Validation

A client MUST reject an event if any of the following holds. Rejection means the
event is not eligible for selection; the client continues with the next
candidate, if any.

1. The event `id` or `sig` does not verify per [NIP-01][].
2. `created_at` is more than 15 minutes in the future by the client's clock.
3. Kind is `17091` and the event contains a `d` tag.
4. Kind is `37091` and the event does not contain exactly one `d` tag.
5. The `d` value is empty, exceeds 64 bytes, or contains whitespace or control
   characters.
6. The event does not contain exactly one `htree` tag.
7. The `htree` value is not of the form `htree://<nhash>` — it uses the `npub`
   form, or carries a path, query string, or fragment.
8. The `nhash` payload is not TLV-encoded, including the legacy bare-32-byte
   form.
9. The `nhash` does not contain exactly one type `0` record, or that record is
   not 32 bytes.
10. The `nhash` contains more than one type `5` record, or a type `5` record
    that is not 32 bytes.
11. The `nhash` contains any TLV type other than `0` and `5`, including types
    reserved by [BUD-18][].
12. Any `nixSigKey` value does not contain exactly one colon, or its name part
    is empty, longer than 64 bytes, or contains whitespace or control
    characters.
13. Any `nixSigKey` key part is not canonical 44-character base64 decoding to
    exactly 32 bytes.

Condition 2 exists because an event dated far in the future would win every
`created_at` comparison indefinitely, pinning the cache to that root and making
every later update unselectable.

An invalid `blossom` tag is not in this list: it is ignored individually rather
than invalidating the event.

## Examples

These examples contain placeholders and therefore are neither valid nor
signable Nostr events.

### Default cache

```json
{
  "id": "<event-id>",
  "pubkey": "<publisher-pubkey>",
  "created_at": 1786406400,
  "kind": 17091,
  "tags": [
    ["htree", "htree://<nhash-with-root-hash>"],
    ["nixSigKey", "cache.example.com-1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="],
    ["blossom", "https://cache.example.com"]
  ],
  "content": "My public Nix cache",
  "sig": "<signature>"
}
```

### Named cache

```json
{
  "id": "<event-id>",
  "pubkey": "<publisher-pubkey>",
  "created_at": 1786406400,
  "kind": 37091,
  "tags": [
    ["d", "nixpkgs-unstable"],
    ["htree", "htree://<nhash-with-root-hash>"],
    ["nixSigKey", "cache.example.com-1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="],
    ["nixSigKey", "cache.example.com-2:AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE="],
    ["blossom", "https://cache.example.com"],
    ["blossom", "https://mirror.example.net"]
  ],
  "content": "Builds from nixpkgs unstable",
  "sig": "<signature>"
}
```

### Unsigned cache

This default-cache event has no `nixSigKey` tags. All `.narinfo` records in its
Hashtree are therefore unsigned and authenticated through the signed event and
content-addressed tree.

```json
{
  "id": "<event-id>",
  "pubkey": "<publisher-pubkey>",
  "created_at": 1786406400,
  "kind": 17091,
  "tags": [
    ["htree", "htree://<nhash-with-root-hash>"]
  ],
  "content": "",
  "sig": "<signature>"
}
```

### Named cache with opaque Blossom chunks

This event publishes a self-encrypted Hashtree. Its `nhash` contains both the
root node hash and the client-side root key. No `blossom` tag is included, so
clients resolve storage servers from the publisher's [BUD-03][] event.

```json
{
  "id": "<event-id>",
  "pubkey": "<publisher-pubkey>",
  "created_at": 1786406400,
  "kind": 37091,
  "tags": [
    ["d", "encrypted-chunks"],
    ["htree", "htree://<nhash-with-root-hash-and-type-5-root-key>"],
    ["nixSigKey", "cache.example.com-1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="]
  ],
  "content": "",
  "sig": "<signature>"
}
```

The client decodes the root hash and key from `nhash`, requests only the root
hash from a Blossom server, and decrypts the returned bytes locally. The client
continues resolving and decrypting child nodes according to the Hashtree
manifests.

## Publishing

Before publishing the event, a publisher MUST make the root manifest and all
blobs needed to traverse the cache available from at least one source it
advertises — a `blossom` tag or its [BUD-03][] list — since that is all a client
with no other knowledge of the cache can try. Publishers SHOULD replicate them
across every advertised server.

A publisher SHOULD publish a cache that is closed under `References`: every
store path referenced by a reachable `.narinfo` record SHOULD itself be
resolvable in the same tree. Where a cache is built up incrementally, store
paths SHOULD be added in topological order — a `.narinfo` record enters the tree
only once its references are already there — so that every intermediate root is
closed as well. A client cannot detect an unclosed cache in advance; it
discovers the gap when substitution fails and falls back to another substituter
or a local build.

To update the default cache, the publisher creates and signs another kind
`17091` event. To update a named cache, the publisher creates and signs another
kind `37091` event with the same `d` tag and a new `htree` URI. A cache name
MUST refer to the same logical cache across updates; a publisher MUST NOT reuse
a name for an unrelated cache.

When rotating a Nix signing key, a publisher SHOULD first publish a cache event
containing both the old and new `nixSigKey` tags. The publisher SHOULD remove an
old key only after no `.narinfo` record reachable from the published root
requires that key.

A publisher SHOULD NOT remove every `nixSigKey` tag from a cache that previously
declared one. Doing so converts a signed cache into an unsigned one, which
clients treat as a downgrade requiring user consent; see Trust and Security.

Relays are not required to retain replaceable events indefinitely, and a cache
whose event has been dropped by every relay a client queries is unreachable even
though its blobs remain. Publishers SHOULD republish periodically, whether or
not the root has changed. Re-sending the identical event is sufficient, since it
carries the same `id`; issuing a fresh `created_at` instead produces a new event
that supersedes the old one.

Publishing a root does not prove that its blobs are available. Clients MAY
check availability before accepting or advertising an update.

## Resolution

A client resolves a publisher's default cache with:

```json
{
  "authors": ["<publisher-pubkey>"],
  "kinds": [17091]
}
```

A client resolves a named cache with:

```json
{
  "authors": ["<publisher-pubkey>"],
  "kinds": [37091],
  "#d": ["<name>"]
}
```

Clients MAY discover named caches without knowing their names by filtering for
kind `37091` events. The dedicated event kind identifies these events as Nix
cache roots.

### Selecting an event

Every candidate event MUST pass Validation before it is considered. Clients MUST
then select among valid events with the same identity according to [NIP-01][]'s
replaceable and addressable event rules.

### Freshness

Those rules only rank the events a client actually receives. A relay that
withholds a newer root and serves a valid older one reverts the client to an
earlier cache state, reintroducing whatever the publisher has since replaced.
The client cannot detect this from the event alone.

Clients SHOULD persist the greatest `created_at` they have accepted for each
cache identity and reject events older than that value. A client that accepts a
root older than one it previously accepted for the same identity MUST report
this to the user. Clients that require freshness SHOULD query multiple relays,
selecting them from the publisher's [NIP-65][] relay list where one is
available.

A cached event is its own staleness window, and querying more relays does not
close it. Clients MAY cache a selected event, but SHOULD bound how long they go
on treating it as current; 15 minutes is RECOMMENDED for a gateway serving other
users, since it cannot know when its consumers need a newer root. Manifests and
blobs need no such bound: they are content-addressed and therefore immutable,
and MAY be cached indefinitely once verified.

### Finding blobs

Every blob in a Hashtree is content-addressed, so where a client fetches from is
not a trust decision: bytes either hash to the address that was requested or
they are discarded. Any resolution strategy is therefore conformant — the
`blossom` tags, the publisher's [BUD-03][] list, a local or shared cache,
operator-configured mirrors, peer exchange, or several of these raced in
parallel.

The event advertises where the publisher put the blobs. It does not restrict
where a client may look. Specifically:

- Clients SHOULD try the selected event's `blossom` tags first, in tag order,
  as that is the publisher's stated preference and the likeliest to succeed.
- Clients SHOULD consult the publisher's [BUD-03][] user server list — the
  latest valid kind `10063` event by the same pubkey, in published order — when
  the event carries no `blossom` tag, and MAY consult it as a fallback even when
  it does.
- Clients MAY use any other source, at any point, including in preference to
  the advertised ones.

A client that exhausts every source it is willing to use MUST report the cache
as unavailable rather than serve unverified bytes.

Clients SHOULD bound how many servers they will try for one cache; 10 is
RECOMMENDED. An event may carry arbitrarily many `blossom` tags, and a client
that tries all of them lets a publisher direct a burst of requests at a target
of its choosing.

### Fetching blobs

The client decodes the `nhash` from the selected event's `htree` tag and fetches
the root manifest as a Blossom blob whose address is the type `0` root hash,
then traverses the tree per [BUD-16][] and [BUD-17][].

Because discovery is deliberately unconstrained, hash verification is the only
thing separating a client from a hostile source. The requirements in this
section are not optional, and they apply to every source equally, including
operator-configured ones.

Every fetched blob MUST be verified against its expected SHA-256 hash before it
is decoded, used, cached, or forwarded. A client MUST discard bytes that do not
match, and MAY then try another source. A client that assembles a blob from
several sources or from range requests MUST verify the SHA-256 of the complete
assembled result; verifying individual ranges is not sufficient.

For a self-encrypted Hashtree, the client MUST follow [BUD-15][]'s order: verify
`SHA256(ciphertext)` against the requested blob address, derive the key,
decrypt, then verify `SHA256(plaintext)` against the expected content key. The
decryption key MUST NOT appear in any request to any source.

Blob requests commonly go to URLs the publisher chose. Clients — especially
gateways, which issue these requests from a host whose network reach the
requesting user does not have — MUST apply the following to any URL they did not
obtain from their own configuration:

- Requests MUST use HTTP or HTTPS only.
- Clients SHOULD refuse to connect to loopback, link-local (`169.254.0.0/16`,
  `fe80::/10`), or private-range addresses unless the operator has explicitly
  allowed them.
- These checks MUST be re-applied to the target of every redirect, not only to
  the original URL, and clients SHOULD bound redirect depth.

Clients MUST bound traversal. A Hashtree is content-addressed, so it cannot
contain a true cycle, but it can share child nodes between many parents and so
expand exponentially in the number of paths walked. Clients MUST deduplicate by
visited node hash and MUST enforce limits on manifest size, tree depth, link
count per node, total node count, and total decoded bytes. A client SHOULD also
enforce the size declared for each link and abort a transfer that exceeds it.

### Consuming `.narinfo` records

A client MUST accept a `.narinfo` record's `Sig` only if the Ed25519 signature
verifies against the key bytes of a `nixSigKey` from the selected publication
event. The names in the `Sig` field and in the `nixSigKey` tag take no part in
this match, and clients MUST NOT compare either to a serving domain. Local Nix
signature policy MAY impose stricter requirements.

A client MUST ignore any `Sig` it cannot verify against that key set, including
every `Sig` in an unsigned cache. An unverifiable `Sig` does not invalidate the
record. A gateway MUST strip such fields before serving the record onward, so
that content published under this NIP is never attributed to a key the selected
event did not declare.

In an unsigned cache, trust comes from the chain:

```text
Nostr event signature -> htree URI -> root hash -> Hashtree links -> blobs
```

The event signature authenticates the publisher and the immutable root
reference. Hash verification authenticates each reachable tree node, `.narinfo`
record, and cache blob relative to that root.

Where no `Sig` verifies against the declared key set, the client MUST attribute
the record to the event's `pubkey` rather than to any Nix signing key, and MUST
reject the record if local policy requires a Nix signature. Rejecting one record
does not require rejecting the cache, though a client MAY do so. A client MAY
reject an unsigned cache outright according to local policy; one that accepts it
MUST verify the event signature and every hash from the `htree` root through the
requested `.narinfo` record and cache blob.

## Trust and Security

The event signature binds the cache identity, Hashtree reference, optional Nix
signing keys, and server list to the publisher's Nostr pubkey. It does not
establish that the publisher is trusted to provide Nix substitutes. The Nostr
key and Nix Ed25519 signing keys remain distinct, and necessarily so: Nix
verifies `.narinfo` signatures with Ed25519 only, so the secp256k1 Schnorr key
that signs a Nostr event cannot also sign a `.narinfo` record. Clients MUST NOT
infer that an advertised Nix key is trusted unless they trust the event's Nostr
publisher.
Clients MUST choose trusted publisher pubkeys through configuration or another
out-of-band trust mechanism.

A Blossom server is an untrusted transport. A client MUST NOT accept bytes whose
SHA-256 differs from the requested blob address. A malicious server can withhold
blobs, but it cannot substitute them.

This is why blob discovery is left open: since the address determines the bytes,
choosing a source is a question of availability and cost, not of trust, and no
source is more authoritative than any other. The corollary is that a client's
defences cannot come from choosing well-behaved servers. They have to come from
verifying every blob, bounding traversal, and constraining outbound requests, as
required under Resolution. A client that skips those checks is unsafe against
its own configured mirrors, not only against a publisher's.

### Downgrade

An event that declares no `nixSigKey` tag turns off Nix signature checking for
that cache. A client that has previously accepted a signed cache for an identity
MUST NOT silently accept that identity becoming unsigned; it MUST obtain
explicit user consent first. Without this rule, anyone able to publish as the
publisher can remove the signature requirement unnoticed.

Rollback of the Hashtree root itself is addressed under Resolution.

### Compromise and revocation

This NIP defines no revocation or tombstone. A client cannot distinguish an
update published with a compromised Nostr key from a legitimate one, and a
publisher cannot signal that a cache is retired. Publishers who need a bounded
lifetime SHOULD attach a [NIP-40][] `expiration` tag and republish on a
schedule; clients MUST honour `expiration` where present. Recovery from Nostr
key compromise is out of band: it requires directing users to a new pubkey.

### Self-encryption

[BUD-15][] derives each blob's encryption key from that blob's own plaintext
(`chk_key = SHA256(plaintext)`) and addresses the blob by `SHA256(ciphertext)`.

This is an at-rest opacity feature for storage operators, not a confidentiality
mechanism. It provides exactly one property: a Blossom server that stores the
chunks without also obtaining the publication event does not hold manifest
contents, file names, `.narinfo` records, or other plaintext in directly
readable form. That lets an operator serve blobs whose contents they have not
inspected.

It provides nothing beyond that:

- The root key is published in a public Nostr event. Any reader who obtains the
  event can decode the whole tree.
- The construction is convergent, so anyone holding a candidate plaintext can
  compute its ciphertext address and probe a server for it. Nix cache contents
  come from public package sets, which makes them cheap to enumerate this way.
- A server that chooses to resolve the publication event obtains the root key
  and can decrypt the tree outright.
- A server always observes ciphertext hashes, sizes, request patterns, and
  timing.

Every cache published by this NIP is therefore public, including one whose
`nhash` carries a decryption key. Self-encryption MUST NOT be described or
treated as a privacy, authorization, or access-control mechanism.

### Presenting the cache to Nix

Presentation is deliberately left open. Nix reads store objects through any of
several store types (see [Nix store types][]), and nothing here requires a
particular one: an implementation MAY serve the cache through the
[HTTP binary cache store][] interface, materialize it as a `file://` binary
cache, mirror it to `s3://`, implement a store of its own, or import store paths
directly. Store choice and its configuration — `StoreDir`, `Priority`,
`trusted-public-keys` wiring, flake `nixConfig` hints — are deployment concerns
this NIP does not carry.

An unmodified Nix client does not understand this Nostr trust chain, and the
absence of `nixSigKey` tags does not change Nix's own substitute-signature
checks. An unsigned cache therefore has to be accepted by policy on the Nix
side — marking the substituter `trusted` where the chosen store type supports
it, or otherwise arranging for Nix to accept the paths. Which mechanism applies
depends on the store type the implementation presents.

In a gateway deployment the checks divide between two parties. The gateway
verifies the event signature and walks the Hashtree from the signed root,
establishing that a `.narinfo` record is the one this publisher indexed. The Nix
client independently verifies that record's `Sig` against its own
`trusted-public-keys` and the NAR against the record's `NarHash` and `FileHash`.
Neither half substitutes for the other, so a gateway operator cannot forge cache
content: they hold no Nix signing key, and Nix rechecks every hash regardless of
where the bytes came from. A client that resolves the cache itself performs both
halves; the separation matters only where the two are different parties.

A `nixSigKey` value is in Nix's own public-key format, so a user configuring
stock Nix can copy it verbatim into `trusted-public-keys`. The name it carries
has to match the name on the `Sig` lines of the cache's `.narinfo` records: Nix
selects keys by name even though this NIP matches on bytes, so a record whose
`Sig` name is absent from the user's configuration is rejected by Nix however
well its signature verifies. Keeping the two consistent is the publisher's
responsibility.

Hash verification covers the compressed bytes of a NAR, not its decompressed
output. A gateway that decompresses SHOULD bound the output against the
`NarSize` declared in the corresponding `.narinfo` record and abort on overrun.
The same record's `NarHash` verifies the decompressed bytes once they exist: the
bound prevents the bomb, the hash catches corruption.

## Dependencies

### Nostr

- [NIP-01][] defines event serialization, signatures, filters, and replaceable
  and addressable event behavior.
- [NIP-40][] defines the `expiration` tag.
- [NIP-65][] defines the relay list identifying where a publisher writes.
- [NIP-B7][] defines Blossom use by Nostr clients and points to the publisher's
  kind `10063` server list.

### Blossom and Hashtree

- [BUD-01][] defines `GET /<sha256>` and `HEAD /<sha256>` blob retrieval.
- [BUD-03][] defines ordered user server lists using kind `10063`.
- [BUD-15][] defines client-side encrypted Blossom blobs.
- [BUD-16][] defines directory manifests.
- [BUD-17][] defines chunked file and directory fanout manifests.
- [BUD-18][] defines `htree://` references and the `nhash` root-hash and
  optional-key encoding used by this NIP.

At the time of writing, [BUD-15][], [BUD-16][], [BUD-17][], and [BUD-18][] are
proposed specifications and have not been merged into the Blossom repository's
default branch.

### Nix

- [Nix binary cache][] defines the binary-cache layout — `nix-cache-info`, one
  [`.narinfo`][] file per store object, and the corresponding [NAR][] data —
  shared by the `http(s)://`, `file://`, and `s3://` store types.
- [Nix store types][] lists the store types a Nix client can read from. This NIP
  requires none of them in particular.
- [HTTP binary cache store][] defines one of those store types, including its
  `trusted` and `trusted-public-keys` behavior. It is cited as an example, not
  as a requirement.
- [`.narinfo`][] defines the line-oriented metadata format and repeatable `Sig`
  fields used by this NIP.
- The [NixOS Binary Cache wiki][] provides non-normative deployment examples
  for substituters, trusted public keys, unsigned/trusted caches, cache
  priority, and flake `nixConfig` hints.

[RFC 2119]: https://www.rfc-editor.org/rfc/rfc2119
[RFC 8174]: https://www.rfc-editor.org/rfc/rfc8174
[NIP-01]: https://github.com/nostr-protocol/nips/blob/master/01.md
[NIP-40]: https://github.com/nostr-protocol/nips/blob/master/40.md
[NIP-65]: https://github.com/nostr-protocol/nips/blob/master/65.md
[NIP-B7]: https://github.com/nostr-protocol/nips/blob/master/B7.md
[BUD-01]: https://github.com/hzrd149/blossom/blob/master/buds/01.md
[BUD-03]: https://github.com/hzrd149/blossom/blob/master/buds/03.md
[BUD-15]: https://github.com/hzrd149/blossom/pull/104
[BUD-16]: https://github.com/hzrd149/blossom/pull/105
[BUD-17]: https://github.com/hzrd149/blossom/pull/106
[BUD-18]: https://github.com/hzrd149/blossom/pull/107
[Nix binary cache]: https://nix.dev/manual/nix/2.35/protocols/binary-cache/
[Nix store types]: https://nix.dev/manual/nix/2.35/store/types/index.html
[HTTP binary cache store]: https://nix.dev/manual/nix/2.35/store/types/http-binary-cache-store.html
[`.narinfo`]: https://nix.dev/manual/nix/2.35/protocols/binary-cache/narinfo.html
[NAR]: https://nix.dev/manual/nix/2.35/store/file-system-object/content-address#serial-nix-archive
[NixOS Binary Cache wiki]: https://wiki.nixos.org/wiki/Binary_Cache#Binary_cache_hint_in_Flakes
