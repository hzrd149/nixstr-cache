import { verifyEvent } from "nostr-tools";
import {
  decodePlaintextNhash,
  NhashError,
  PlaintextRoot,
  UnsupportedEncryptedRootError,
} from "./nhash.ts";

export interface RawPublication {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

export interface PublicationIdentity {
  readonly kind: 17091 | 37091;
  readonly pubkey: string;
  readonly name?: string;
}

export interface NixSignatureKey {
  readonly name: string;
  readonly encoded: string;
  readonly bytes: Uint8Array;
}

const validatedBrand: unique symbol = Symbol("ValidatedPublication");
export interface ValidatedPublication {
  readonly [validatedBrand]: true;
  readonly event: Readonly<RawPublication>;
  readonly identity: PublicationIdentity;
  readonly root: PlaintextRoot;
  readonly nixSigKeys: readonly NixSignatureKey[];
  readonly blossomServers: readonly string[];
  readonly expiresAt?: number;
}

export type PublicationRejectionCode =
  | "invalid-event"
  | "future"
  | "expired"
  | "kind"
  | "identity"
  | "htree"
  | "nhash"
  | "unsupported-encryption"
  | "nix-signature-key"
  | "resource-limit";

export interface PublicationRejection {
  readonly code: PublicationRejectionCode;
  readonly message: string;
}

export type PublicationValidationResult =
  | { readonly ok: true; readonly value: ValidatedPublication }
  | { readonly ok: false; readonly error: PublicationRejection };

const encoder = new TextEncoder();
const reject = (
  code: PublicationRejectionCode,
  message: string,
): PublicationValidationResult => ({
  ok: false,
  error: Object.freeze({ code, message }),
});

function validLabel(value: string): boolean {
  const bytes = encoder.encode(value);
  return bytes.length > 0 && bytes.length <= 64 && !Array.from(value).some(
    (character) =>
      /\s/u.test(character) || character.charCodeAt(0) < 32 ||
      character.charCodeAt(0) === 127,
  );
}

function parseNixKeys(
  tags: string[][],
): NixSignatureKey[] | PublicationRejection {
  const byBytes = new Map<string, NixSignatureKey>();
  const names = new Map<string, string>();
  for (const tag of tags.filter((tag) => tag[0] === "nixSigKey")) {
    if (tag.length !== 2) {
      return { code: "nix-signature-key", message: "malformed nixSigKey tag" };
    }
    const value = tag[1];
    const colon = value.indexOf(":");
    if (colon <= 0 || colon !== value.lastIndexOf(":")) {
      return {
        code: "nix-signature-key",
        message: "nixSigKey requires exactly one colon",
      };
    }
    const name = value.slice(0, colon);
    const encoded = value.slice(colon + 1);
    if (!validLabel(name) || !/^[A-Za-z0-9+/]{43}=$/.test(encoded)) {
      return {
        code: "nix-signature-key",
        message: "invalid nixSigKey name or base64",
      };
    }
    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
    } catch {
      return { code: "nix-signature-key", message: "invalid nixSigKey base64" };
    }
    if (
      bytes.length !== 32 || btoa(String.fromCharCode(...bytes)) !== encoded
    ) {
      return { code: "nix-signature-key", message: "non-canonical nixSigKey" };
    }
    const keyHex = Array.from(
      bytes,
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    const prior = names.get(name);
    if (prior && prior !== keyHex) {
      return {
        code: "nix-signature-key",
        message: "one nixSigKey name declares multiple keys",
      };
    }
    names.set(name, keyHex);
    if (!byBytes.has(keyHex)) {
      byBytes.set(keyHex, Object.freeze({ name, encoded, bytes }));
    }
  }
  return [...byBytes.values()];
}

function validBlossomUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") || url.username ||
      url.password
    ) return;
    if (!url.hostname || url.search || url.hash) return;
    return value.replace(/\/+$/, "");
  } catch {
    return;
  }
}

export function validatePublication(
  raw: RawPublication,
  now: number,
): PublicationValidationResult {
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(raw.created_at)) {
    return reject("invalid-event", "invalid timestamp");
  }
  if (
    !Array.isArray(raw.tags) || raw.tags.length > 256 ||
    raw.content.length > 65_536 ||
    raw.tags.some((tag) =>
      !Array.isArray(tag) || tag.length > 8 ||
      tag.some((field) => typeof field !== "string" || field.length > 4096)
    )
  ) {
    return reject("resource-limit", "event exceeds validation limits");
  }
  try {
    // Never pass through symbol properties: nostr-tools memoizes verification on
    // the object, and an attacker-controlled/spread object could carry that cache.
    const verificationCopy = {
      id: raw.id,
      pubkey: raw.pubkey,
      created_at: raw.created_at,
      kind: raw.kind,
      tags: raw.tags.map((tag) => [...tag]),
      content: raw.content,
      sig: raw.sig,
    };
    if (!verifyEvent(verificationCopy)) {
      return reject(
        "invalid-event",
        "NIP-01 id or signature verification failed",
      );
    }
  } catch {
    return reject("invalid-event", "NIP-01 event shape is invalid");
  }
  if (raw.created_at > now + 900) {
    return reject(
      "future",
      "publication is more than 15 minutes in the future",
    );
  }
  if (raw.kind !== 17091 && raw.kind !== 37091) {
    return reject("kind", "unsupported publication kind");
  }

  const dTags = raw.tags.filter((tag) => tag[0] === "d");
  let name: string | undefined;
  if (raw.kind === 17091) {
    if (dTags.length !== 0) {
      return reject("identity", "default cache must not have a d tag");
    }
  } else {
    if (
      dTags.length !== 1 || dTags[0].length !== 2 || !validLabel(dTags[0][1])
    ) {
      return reject("identity", "named cache requires one valid d tag");
    }
    name = dTags[0][1];
  }

  const htreeTags = raw.tags.filter((tag) => tag[0] === "htree");
  if (
    htreeTags.length !== 1 || htreeTags[0].length !== 2 ||
    !htreeTags[0][1].startsWith("htree://")
  ) {
    return reject(
      "htree",
      "publication requires exactly one immutable htree tag",
    );
  }
  const nhash = htreeTags[0][1].slice("htree://".length);
  if (!nhash || /[/?#]/.test(nhash)) {
    return reject("htree", "htree reference must identify a root nhash");
  }
  let root: PlaintextRoot;
  try {
    root = decodePlaintextNhash(nhash);
  } catch (error) {
    return error instanceof UnsupportedEncryptedRootError
      ? reject("unsupported-encryption", error.message)
      : reject(
        "nhash",
        error instanceof NhashError ? error.message : "invalid nhash",
      );
  }

  const keys = parseNixKeys(raw.tags);
  if (!Array.isArray(keys)) return { ok: false, error: Object.freeze(keys) };
  const expirations = raw.tags.filter((tag) => tag[0] === "expiration");
  let expiresAt: number | undefined;
  if (expirations.length) {
    if (
      expirations.length !== 1 || expirations[0].length !== 2 ||
      !/^(0|[1-9][0-9]*)$/.test(expirations[0][1])
    ) {
      return reject("expired", "malformed expiration tag");
    }
    expiresAt = Number(expirations[0][1]);
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) {
      return reject("expired", "publication has expired");
    }
  }

  const event = Object.freeze({
    ...raw,
    tags: Object.freeze(raw.tags.map((tag) => Object.freeze([...tag]))),
  }) as unknown as Readonly<RawPublication>;
  const identity = Object.freeze({
    kind: raw.kind,
    pubkey: raw.pubkey,
    ...(name === undefined ? {} : { name }),
  }) as PublicationIdentity;
  const value = {
    [validatedBrand]: true as const,
    event,
    identity,
    root,
    nixSigKeys: Object.freeze(keys),
    blossomServers: Object.freeze(
      raw.tags.filter((tag) => tag[0] === "blossom" && tag.length === 2).map((
        tag,
      ) => validBlossomUrl(tag[1])).filter((url): url is string =>
        url !== undefined
      ),
    ),
    ...(expiresAt === undefined ? {} : { expiresAt }),
  };
  return { ok: true, value: Object.freeze(value) };
}

export function cacheIdentity(publication: ValidatedPublication): string {
  const { kind, pubkey, name } = publication.identity;
  return `${kind}:${pubkey}:${name ?? ""}`;
}
