import { bech32 } from "@scure/base";

export class NhashError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NhashError";
  }
}

export class UnsupportedEncryptedRootError extends NhashError {
  constructor() {
    super("BUD-15 encrypted roots are unsupported");
    this.name = "UnsupportedEncryptedRootError";
  }
}

export interface PlaintextRoot {
  readonly bytes: Uint8Array;
  readonly hex: string;
  readonly nhash: string;
}

export function decodePlaintextNhash(value: string): PlaintextRoot {
  if (value.length > 200 || value !== value.toLowerCase()) {
    throw new NhashError("nhash is not canonical lowercase Bech32");
  }
  let decoded: { prefix: string; words: number[] };
  try {
    decoded = bech32.decode(value, 200);
  } catch {
    throw new NhashError("invalid nhash Bech32 encoding");
  }
  if (decoded.prefix !== "nhash") throw new NhashError("wrong nhash HRP");
  let payload: Uint8Array;
  try {
    payload = Uint8Array.from(bech32.fromWords(decoded.words));
  } catch {
    throw new NhashError("invalid nhash word padding");
  }
  if (bech32.encode("nhash", bech32.toWords(payload), 200) !== value) {
    throw new NhashError("non-canonical nhash encoding");
  }

  const records: Array<{ type: number; value: Uint8Array }> = [];
  for (let offset = 0; offset < payload.length;) {
    if (offset + 2 > payload.length) {
      throw new NhashError("truncated TLV header");
    }
    const type = payload[offset++];
    const length = payload[offset++];
    if (offset + length > payload.length) {
      throw new NhashError("truncated TLV value");
    }
    records.push({ type, value: payload.slice(offset, offset + length) });
    offset += length;
  }
  const roots = records.filter((record) => record.type === 0);
  const keys = records.filter((record) => record.type === 5);
  if (records.some((record) => record.type !== 0 && record.type !== 5)) {
    throw new NhashError("unknown TLV record type");
  }
  if (roots.length !== 1 || roots[0].value.length !== 32) {
    throw new NhashError("nhash requires exactly one 32-byte root");
  }
  if (keys.some((record) => record.value.length !== 32) || keys.length > 1) {
    throw new NhashError("invalid encrypted-root key record");
  }
  if (keys.length === 1) throw new UnsupportedEncryptedRootError();

  const bytes = roots[0].value.slice();
  return Object.freeze({
    bytes,
    hex: Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    ),
    nhash: value,
  });
}
