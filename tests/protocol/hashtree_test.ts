import { assertEquals, assertThrows } from "@std/assert";
import { encode } from "@msgpack/msgpack";
import { decodeManifest, ManifestDataError } from "../../src/protocol/hashtree.ts";

const hex = (value: string) => Uint8Array.fromHex(value);
const H = (byte: number) => new Uint8Array(32).fill(byte);

Deno.test("pinned BUD-16/17 vectors decode into strict manifests", () => {
  const directory = decodeManifest(hex("82a16c9184a168c420ababababababababababababababababababababababababababababababababa16ea8746573742e747874a17364a17400a17402"), { maxWireBytes: 4096, maxDecodedBytes: 4096, maxLinks: 10 });
  assertEquals(directory.type, "directory");
  assertEquals(directory.links[0].name, "test.txt");
  const file = decodeManifest(hex("82a16c9283a168c420aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa17364a1740083a168c420bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbba17332a17400a17401"), { maxWireBytes: 4096, maxDecodedBytes: 4096, maxLinks: 10 });
  assertEquals(file.type, "file");
  assertEquals(file.links.map((x) => x.size), [100, 50]);
});

Deno.test("directories reject duplicate, unsafe, and unsorted names", () => {
  for (const names of [["a", "a"], ["b", "a"], ["a/b"], [".."]]) {
    const l = names.map((n) => ({ h: H(1), n, s: 1, t: 0 }));
    assertThrows(() => decodeManifest(encode({ l, t: 2 }), { maxWireBytes: 4096, maxDecodedBytes: 4096, maxLinks: 10 }), ManifestDataError);
  }
});

Deno.test("file and fanout invariants are validated completely", () => {
  assertThrows(() => decodeManifest(encode({ l: [{ h: H(1), n: "bad", s: 1, t: 0 }], t: 1 }), { maxWireBytes: 4096, maxDecodedBytes: 4096, maxLinks: 10 }), ManifestDataError);
  const overlap = { l: [
    { h: H(1), m: { count: 1, first: "a", last: "c" }, s: 0, t: 2 },
    { h: H(2), m: { count: 1, first: "c", last: "d" }, s: 0, t: 2 },
  ], t: 3 };
  assertThrows(() => decodeManifest(encode(overlap), { maxWireBytes: 4096, maxDecodedBytes: 4096, maxLinks: 10 }), ManifestDataError);
  assertThrows(() => decodeManifest(encode({ l: [], t: 9 }), { maxWireBytes: 4096, maxDecodedBytes: 4096, maxLinks: 10 }), ManifestDataError);
});

Deno.test("wire, decoded metadata, links, keys, and trailing data are bounded", () => {
  const valid = encode({ l: [], t: 2 });
  assertThrows(() => decodeManifest(valid, { maxWireBytes: valid.length - 1, maxDecodedBytes: 99, maxLinks: 1 }), ManifestDataError);
  assertThrows(() => decodeManifest(encode({ l: [{ h: H(1), n: "a", s: 1, t: 0 }], t: 2 }), { maxWireBytes: 4096, maxDecodedBytes: 1, maxLinks: 10 }), ManifestDataError);
  assertThrows(() => decodeManifest(encode({ l: [], t: 2, x: 1 }), { maxWireBytes: 4096, maxDecodedBytes: 99, maxLinks: 1 }), ManifestDataError);
  assertThrows(() => decodeManifest(new Uint8Array([...valid, 0]), { maxWireBytes: 4096, maxDecodedBytes: 99, maxLinks: 1 }), ManifestDataError);
});
