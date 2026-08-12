import { assertEquals, assertThrows } from "@std/assert";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  appendNarInfoSignatures,
  classifyEndorsements,
  differingNarInfoFields,
  parseNarInfo,
  serializeNarInfo,
} from "../../src/protocol/narinfo.ts";

const base = [
  "StorePath: /nix/store/0123456789abcdfghijklmnpqrsvwxyz-demo",
  "URL: nar/demo.nar",
  "Compression: none",
  "FileHash: sha256:0123456789abcdfghijklmnpqrsvwxyz0123456789abcdfghijk",
  "FileSize: 3",
  "NarHash: sha256:0123456789abcdfghijklmnpqrsvwxyz0123456789abcdfghijk",
  "NarSize: 3",
  "References: ",
];

Deno.test("narinfo preserves ordered signature lines byte-for-byte", () => {
  const sigs = [
    "Sig: endorsed:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
    "Sig: another:AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ==",
    "Sig: endorsed:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
  ];
  const text = [...base, ...sigs, "Deriver: unknown-deriver", ""].join("\n");
  const parsed = parseNarInfo(text);
  assertEquals(parsed.signatures.map((signature) => signature.rawLine), sigs);
  assertEquals(serializeNarInfo(parsed), text);
});

Deno.test("narinfo permits unsigned records and rejects ambiguous scalars", () => {
  assertEquals(parseNarInfo([...base, ""].join("\n")).signatures, []);
  assertThrows(() => parseNarInfo([...base, base[0], ""].join("\n")));
  assertThrows(() => parseNarInfo([...base.slice(1), ""].join("\n")));
  assertThrows(() => parseNarInfo([...base, "Unknown: value", ""].join("\n")));
});

Deno.test("narinfo rejects malformed or non-canonical signatures", () => {
  assertThrows(() =>
    parseNarInfo([...base, "Sig: missing-colon", ""].join("\n"))
  );
  assertThrows(() => parseNarInfo([...base, "Sig: bad:!!!!", ""].join("\n")));
  assertThrows(() =>
    parseNarInfo([...base, `Sig: bad:${"A".repeat(88)}`, ""].join("\n"))
  );
});

Deno.test("endorsement uses key bytes independently of signature names", async () => {
  const secret = new Uint8Array(32).fill(7);
  const publicKey = ed25519.getPublicKey(secret);
  const unsigned = parseNarInfo([...base, ""].join("\n"));
  const signature = ed25519.sign(
    new TextEncoder().encode(unsigned.fingerprint),
    secret,
  );
  const encoded = btoa(String.fromCharCode(...signature));
  const text = [...base, `Sig: unrelated-name:${encoded}`, ""].join("\n");
  const parsed = parseNarInfo(text);
  const result = await classifyEndorsements(parsed, [{
    name: "publisher-name",
    encoded: btoa(String.fromCharCode(...publicKey)),
    bytes: publicKey,
  }]);
  assertEquals(result, [{ signatureIndex: 0, endorsed: true, keyIndex: 0 }]);
  assertEquals(serializeNarInfo(parsed), text);
  assertThrows(() =>
    classifyEndorsements(parsed, [{
      name: "bad",
      encoded: "",
      bytes: new Uint8Array(31),
    }])
  );
});

Deno.test("narinfo semantic projection covers optional presence and parsed scalars", () => {
  const first = parseNarInfo([
    base[2],
    base[0],
    base[1],
    base[3],
    "FileSize: 03",
    base[5],
    "NarSize: 03",
    base[7],
    "Deriver: unknown-deriver",
    "System: x86_64-linux",
    "CA: fixed:r:sha256:abc",
    "",
  ].join("\n"));
  const second = parseNarInfo([
    ...base,
    "CA: fixed:r:sha256:abc",
    "System: x86_64-linux",
    "Deriver: unknown-deriver",
    "",
  ].join("\n"));
  assertEquals(differingNarInfoFields(first, second), []);
  const absent = parseNarInfo([...base, "System: x86_64-linux", ""].join("\n"));
  assertEquals(differingNarInfoFields(first, absent), ["Deriver", "CA"]);
});

Deno.test("signature append preserves winner layout and duplicate occurrences", () => {
  const signature =
    "Sig: duplicate:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";
  const winner = parseNarInfo(
    [...base, signature, "System: x86_64-linux", ""].join("\n"),
  );
  assertEquals(
    appendNarInfoSignatures(winner, [signature, signature]),
    [...base, signature, "System: x86_64-linux", signature, signature, ""].join(
      "\n",
    ),
  );
});

Deno.test("every supported non-signature field participates in agreement", () => {
  const complete = [
    ...base,
    "Deriver: unknown",
    "System: x86_64-linux",
    "CA: fixed:r:sha256:abc",
  ];
  const alternatives: Readonly<Record<string, string>> = {
    StorePath: "StorePath: /nix/store/1123456789abcdfghijklmnpqrsvwxyz-demo",
    URL: "URL: nar/other.nar",
    Compression: "Compression: xz",
    FileHash:
      "FileHash: sha256:1123456789abcdfghijklmnpqrsvwxyz0123456789abcdfghijk",
    FileSize: "FileSize: 4",
    NarHash:
      "NarHash: sha256:1123456789abcdfghijklmnpqrsvwxyz0123456789abcdfghijk",
    NarSize: "NarSize: 4",
    References: "References: 1123456789abcdfghijklmnpqrsvwxyz-other",
    Deriver: "Deriver: another",
    System: "System: aarch64-linux",
    CA: "CA: fixed:r:sha256:def",
  };
  const baseline = parseNarInfo([...complete, ""].join("\n"));
  for (const [field, replacement] of Object.entries(alternatives)) {
    const changed = complete.map((line) =>
      line.startsWith(`${field}: `) ? replacement : line
    );
    assertEquals(
      differingNarInfoFields(
        baseline,
        parseNarInfo([...changed, ""].join("\n")),
      ),
      [field],
    );
  }
});
