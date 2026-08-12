import { ed25519 } from "npm:@noble/curves@2.3.0/ed25519.js";
import type { NixSignatureKey } from "./publication.ts";

export class NarInfoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NarInfoError";
  }
}

export interface NarInfoSignature {
  readonly name: string;
  readonly encoded: string;
  readonly bytes: Uint8Array;
  readonly rawLine: string;
}

export interface NarInfo {
  readonly storePath: string;
  readonly url: string;
  readonly compression: string;
  readonly fileHash: string;
  readonly fileSize: number;
  readonly narHash: string;
  readonly narSize: number;
  readonly references: readonly string[];
  readonly signatures: readonly NarInfoSignature[];
  readonly fingerprint: string;
  readonly rawText: string;
}

export interface Endorsement {
  readonly signatureIndex: number;
  readonly endorsed: boolean;
  readonly keyIndex?: number;
}

const REQUIRED = [
  "StorePath",
  "URL",
  "Compression",
  "FileHash",
  "FileSize",
  "NarHash",
  "NarSize",
  "References",
] as const;
const OPTIONAL = new Set(["Deriver", "System", "CA"]);

function canonicalBase64(value: string, bytes: number): Uint8Array {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new NarInfoError("signature is not standard base64");
  }
  let decoded: Uint8Array;
  try {
    decoded = Uint8Array.from(
      atob(value),
      (character) => character.charCodeAt(0),
    );
  } catch {
    throw new NarInfoError("signature is not valid base64");
  }
  if (
    decoded.length !== bytes || btoa(String.fromCharCode(...decoded)) !== value
  ) {
    throw new NarInfoError(`signature must be canonical ${bytes}-byte base64`);
  }
  return decoded;
}

function unsignedInteger(value: string, field: string): number {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new NarInfoError(`${field} is invalid`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new NarInfoError(`${field} is too large`);
  }
  return parsed;
}

export function parseNarInfo(text: string): NarInfo {
  if (!text.endsWith("\n") || text.includes("\r") || text.includes("\0")) {
    throw new NarInfoError("narinfo must be LF-terminated text");
  }
  const scalars = new Map<string, string>();
  const signatures: NarInfoSignature[] = [];
  for (const line of text.slice(0, -1).split("\n")) {
    const separator = line.indexOf(": ");
    if (separator <= 0) throw new NarInfoError("malformed narinfo line");
    const field = line.slice(0, separator);
    const value = line.slice(separator + 2);
    if (field === "Sig") {
      const colon = value.indexOf(":");
      if (colon <= 0 || colon !== value.lastIndexOf(":")) {
        throw new NarInfoError("Sig requires exactly one colon");
      }
      const name = value.slice(0, colon);
      if (!name || /[\s\x00-\x1f\x7f]/.test(name)) {
        throw new NarInfoError("invalid Sig name");
      }
      const encoded = value.slice(colon + 1);
      signatures.push(Object.freeze({
        name,
        encoded,
        bytes: canonicalBase64(encoded, 64),
        rawLine: line,
      }));
      continue;
    }
    if (
      !REQUIRED.includes(field as typeof REQUIRED[number]) &&
      !OPTIONAL.has(field)
    ) {
      throw new NarInfoError(`unknown narinfo field: ${field}`);
    }
    if (scalars.has(field)) {
      throw new NarInfoError(`duplicate scalar field: ${field}`);
    }
    scalars.set(field, value);
  }
  for (const field of REQUIRED) {
    if (!scalars.has(field)) {
      throw new NarInfoError(`missing required field: ${field}`);
    }
  }
  const storePath = scalars.get("StorePath")!;
  const url = scalars.get("URL")!;
  const compression = scalars.get("Compression")!;
  const fileHash = scalars.get("FileHash")!;
  const narHash = scalars.get("NarHash")!;
  if (!/^\/nix\/store\/[0-9a-z]{32}-[^/\s]+$/.test(storePath)) {
    throw new NarInfoError("invalid StorePath");
  }
  if (
    !url || url.startsWith("/") || url.includes("\\") ||
    url.split("/").some((part) => part === "..")
  ) throw new NarInfoError("invalid URL");
  if (!compression || /\s/.test(compression)) {
    throw new NarInfoError("invalid Compression");
  }
  if (
    !/^sha256:[0-9a-z]+$/.test(fileHash) || !/^sha256:[0-9a-z]+$/.test(narHash)
  ) throw new NarInfoError("invalid hash");
  const fileSize = unsignedInteger(scalars.get("FileSize")!, "FileSize");
  const narSize = unsignedInteger(scalars.get("NarSize")!, "NarSize");
  const references = scalars.get("References")!.split(" ").filter(Boolean);
  if (
    references.some((reference) => !/^[0-9a-z]{32}-[^/\s]+$/.test(reference))
  ) throw new NarInfoError("invalid References");
  const fingerprint = `1;${storePath};${narHash};${narSize};${
    references.join(",")
  }`;
  return Object.freeze({
    storePath,
    url,
    compression,
    fileHash,
    fileSize,
    narHash,
    narSize,
    references: Object.freeze(references),
    signatures: Object.freeze(signatures),
    fingerprint,
    rawText: text,
  });
}

export function serializeNarInfo(narinfo: NarInfo): string {
  return narinfo.rawText;
}

export async function classifyEndorsements(
  narinfo: NarInfo,
  keys: readonly NixSignatureKey[],
): Promise<readonly Endorsement[]> {
  const message = new TextEncoder().encode(narinfo.fingerprint);
  return await Promise.all(
    narinfo.signatures.map(async (signature, signatureIndex) => {
      let keyIndex: number | undefined;
      for (let index = 0; index < keys.length; index++) {
        if (keys[index].bytes.length !== 32) {
          throw new NarInfoError("endorsement key must be 32 bytes");
        }
        if (ed25519.verify(signature.bytes, message, keys[index].bytes)) {
          keyIndex = index;
          break;
        }
      }
      return Object.freeze({
        signatureIndex,
        endorsed: keyIndex !== undefined,
        ...(keyIndex === undefined ? {} : { keyIndex }),
      });
    }),
  );
}
