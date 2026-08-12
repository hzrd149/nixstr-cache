import { assertEquals, assertExists, assertInstanceOf } from "@std/assert";
import { bech32 } from "@scure/base";
import { finalizeEvent, generateSecretKey } from "nostr-tools";
import {
  decodePlaintextNhash,
  NhashError,
  UnsupportedEncryptedRootError,
} from "../../src/protocol/nhash.ts";
import {
  cacheIdentity,
  validatePublication,
} from "../../src/protocol/publication.ts";

const NOW = 1_786_406_400;
const secret = generateSecretKey();
const root = new Uint8Array(32).fill(7);

function nhash(records: Array<[number, Uint8Array]>): string {
  const bytes = records.flatMap((
    [type, value],
  ) => [type, value.length, ...value]);
  return bech32.encode("nhash", bech32.toWords(Uint8Array.from(bytes)), 200);
}

function event(
  overrides: Partial<
    { kind: number; created_at: number; tags: string[][]; content: string }
  > = {},
) {
  return finalizeEvent({
    kind: overrides.kind ?? 17091,
    created_at: overrides.created_at ?? NOW,
    tags: overrides.tags ?? [["htree", `htree://${nhash([[0, root]])}`]],
    content: overrides.content ?? "",
  }, secret);
}

Deno.test("strict plaintext nhash accepts exactly one canonical type-0 root", () => {
  const encoded = nhash([[0, root]]);
  assertEquals(decodePlaintextNhash(encoded).bytes, root);
  assertInstanceOf(
    (() => {
      try {
        decodePlaintextNhash(nhash([[0, root], [5, root]]));
      } catch (error) {
        return error;
      }
    })(),
    UnsupportedEncryptedRootError,
  );
  for (
    const records of [
      [] as Array<[number, Uint8Array]>,
      [[0, root], [0, root]] as Array<[number, Uint8Array]>,
      [[1, root]] as Array<[number, Uint8Array]>,
      [[0, root.subarray(1)]] as Array<[number, Uint8Array]>,
    ]
  ) {
    let caught: unknown;
    try {
      decodePlaintextNhash(nhash(records));
    } catch (error) {
      caught = error;
    }
    assertInstanceOf(caught, NhashError);
  }
});

Deno.test("publication validates signature, time boundaries, expiry, and tag multiplicity", () => {
  assertEquals(
    validatePublication(event({ created_at: NOW + 900 }), NOW).ok,
    true,
  );
  assertEquals(
    validatePublication(event({ created_at: NOW + 901 }), NOW).ok,
    false,
  );
  assertEquals(
    validatePublication(event({ tags: [["expiration", String(NOW)]] }), NOW).ok,
    false,
  );
  assertEquals(
    validatePublication(event({ tags: [["htree", "x"], ["htree", "y"]] }), NOW)
      .ok,
    false,
  );
  const tampered = { ...event(), content: "tampered" };
  assertEquals(validatePublication(tampered, NOW).ok, false);
});

Deno.test("default and named publications preserve raw identity and ordered valid sources", () => {
  const keyA = `a:${btoa(String.fromCharCode(...new Uint8Array(32)))}`;
  const keyB = `renamed:${btoa(String.fromCharCode(...new Uint8Array(32)))}`;
  const named = event({
    kind: 37091,
    content: "description",
    tags: [
      ["d", "Cafe\u0301"],
      ["htree", `htree://${nhash([[0, root]])}`],
      ["nixSigKey", keyA],
      ["nixSigKey", keyB],
      ["blossom", "https://one.example/base/"],
      ["blossom", "ftp://invalid.example"],
      ["blossom", "https://two.example"],
    ],
  });
  const result = validatePublication(named, NOW);
  assertEquals(result.ok, true);
  if (!result.ok) return;
  assertEquals(cacheIdentity(result.value), `37091:${named.pubkey}:Cafe\u0301`);
  assertEquals(result.value.identity.name, "Cafe\u0301");
  assertEquals(result.value.nixSigKeys.length, 1);
  assertEquals(result.value.blossomServers, [
    "https://one.example/base",
    "https://two.example",
  ]);
  assertExists(result.value.root);
  assertEquals(Object.isFrozen(result.value), true);
});

Deno.test("invalid d and nixSigKey values are rejected with structured codes", () => {
  const cases = [
    event({
      kind: 17091,
      tags: [["d", "named"], ["htree", `htree://${nhash([[0, root]])}`]],
    }),
    event({ kind: 37091, tags: [["htree", `htree://${nhash([[0, root]])}`]] }),
    event({
      kind: 37091,
      tags: [["d", ""], ["htree", `htree://${nhash([[0, root]])}`]],
    }),
    event({
      tags: [["htree", `htree://${nhash([[0, root]])}`], [
        "nixSigKey",
        "bad:key:extra",
      ]],
    }),
  ];
  for (const candidate of cases) {
    const result = validatePublication(candidate, NOW);
    assertEquals(result.ok, false);
    if (!result.ok) assertExists(result.error.code);
  }
});
