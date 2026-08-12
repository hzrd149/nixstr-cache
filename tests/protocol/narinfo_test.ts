import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { ed25519 } from "npm:@noble/curves@2.3.0/ed25519.js";
import {
  classifyEndorsements,
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
  await assertRejects(async () =>
    classifyEndorsements(parsed, [{
      name: "bad",
      encoded: "",
      bytes: new Uint8Array(31),
    }])
  );
});
