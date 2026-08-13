import { verifyEvent } from "nostr-tools";
import type { EventTemplate, VerifiedEvent } from "nostr-tools";

export const MAX_UPLOAD_AUTHORIZATION_HASHES = 64;
// Keep the complete serialized `Authorization: Nostr ...\r\n` field at or
// below 6 KiB. Common HTTP servers/proxies allow 8 KiB per header or request
// header block; reserving 2 KiB avoids consuming that entire budget with one
// token while still batching many 64-byte hash tags per signer prompt.
export const MAX_UPLOAD_AUTHORIZATION_HEADER_BYTES = 6 * 1024;

const AUTHORIZATION_PREFIX = "Authorization: ";
const AUTHORIZATION_SUFFIX = "\r\n";

export interface UploadAuthorizationSigner {
  signEvent(
    template: EventTemplate,
    signal?: AbortSignal,
  ): Promise<VerifiedEvent>;
}

export interface UploadAuthorizationBatch {
  readonly expiration: number;
  readonly eventCount: number;
  header(server: string, hash: string): string | undefined;
}

interface CanonicalSignedEvent {
  readonly id: string;
  readonly pubkey: string;
  readonly created_at: number;
  readonly kind: number;
  readonly tags: readonly string[][];
  readonly content: string;
  readonly sig: string;
}

function canonicalSignedEvent(event: VerifiedEvent): CanonicalSignedEvent {
  return {
    id: event.id,
    pubkey: event.pubkey,
    created_at: event.created_at,
    kind: event.kind,
    tags: event.tags,
    content: event.content,
    sig: event.sig,
  };
}

function encodeAuthorizationHeader(event: CanonicalSignedEvent): string {
  const bytes = new TextEncoder().encode(JSON.stringify(event));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `Nostr ${
    btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")
  }`;
}

function authorizationFieldBytes(value: string): number {
  return new TextEncoder().encode(
    `${AUTHORIZATION_PREFIX}${value}${AUTHORIZATION_SUFFIX}`,
  ).length;
}

function conservativeAuthorizationFieldBytes(template: EventTemplate): number {
  return authorizationFieldBytes(encodeAuthorizationHeader({
    id: "0".repeat(64),
    pubkey: "0".repeat(64),
    created_at: template.created_at,
    kind: template.kind,
    tags: template.tags,
    content: template.content,
    sig: "0".repeat(128),
  }));
}

function scopedDomain(server: string): string | undefined {
  const hostname = new URL(server).hostname.toLowerCase();
  if (
    hostname.includes(":") || /^\d+(?:\.\d+){3}$/.test(hostname) ||
    !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(hostname)
  ) return undefined;
  return hostname;
}

function exactSignedTemplate(
  event: VerifiedEvent,
  template: EventTemplate,
): boolean {
  return event.kind === template.kind &&
    event.created_at === template.created_at &&
    event.content === template.content &&
    JSON.stringify(event.tags) === JSON.stringify(template.tags) &&
    verifyEvent(event);
}

export async function createUploadAuthorizationBatch(options: {
  readonly signer: UploadAuthorizationSigner;
  readonly hashes: readonly string[];
  readonly servers: readonly string[];
  readonly now: number;
  readonly lifetimeSeconds?: number;
  readonly maxHashesPerEvent?: number;
  readonly maxHeaderBytes?: number;
  readonly signal?: AbortSignal;
}): Promise<UploadAuthorizationBatch> {
  const maxHashes = options.maxHashesPerEvent ??
    MAX_UPLOAD_AUTHORIZATION_HASHES;
  if (!Number.isSafeInteger(maxHashes) || maxHashes < 1) {
    throw new RangeError("invalid upload authorization hash limit");
  }
  const maxHeaderBytes = options.maxHeaderBytes ??
    MAX_UPLOAD_AUTHORIZATION_HEADER_BYTES;
  if (!Number.isSafeInteger(maxHeaderBytes) || maxHeaderBytes < 1) {
    throw new RangeError("invalid upload authorization header limit");
  }
  const hashes = [...new Set(options.hashes)];
  if (
    hashes.length === 0 ||
    hashes.some((hash) => !/^[0-9a-f]{64}$/.test(hash))
  ) throw new TypeError("invalid upload authorization hashes");

  const expiration = options.now + (options.lifetimeSeconds ?? 3600);
  const scopes = new Map<string, { domain?: string; servers: string[] }>();
  for (const server of options.servers) {
    const domain = scopedDomain(server);
    const key = domain ?? "*";
    const scope = scopes.get(key) ?? { domain, servers: [] };
    scope.servers.push(server);
    scopes.set(key, scope);
  }
  const headers = new Map<string, Map<string, string>>();
  let eventCount = 0;
  for (const scope of scopes.values()) {
    let offset = 0;
    while (offset < hashes.length) {
      options.signal?.throwIfAborted();
      const group: string[] = [];
      while (offset < hashes.length && group.length < maxHashes) {
        const candidate = [...group, hashes[offset]];
        const candidateTemplate = uploadTemplate(
          options.now,
          expiration,
          scope.domain,
          candidate,
        );
        if (
          conservativeAuthorizationFieldBytes(candidateTemplate) >
            maxHeaderBytes
        ) {
          if (group.length === 0) {
            throw new RangeError(
              "upload authorization header limit cannot fit one hash",
            );
          }
          break;
        }
        group.push(hashes[offset]);
        offset++;
      }
      const template: EventTemplate = {
        ...uploadTemplate(options.now, expiration, scope.domain, group),
      };
      const event = await options.signer.signEvent(template, options.signal);
      options.signal?.throwIfAborted();
      if (!exactSignedTemplate(event, template)) {
        throw new Error("signer changed Blossom authorization template");
      }
      const header = encodeAuthorizationHeader(canonicalSignedEvent(event));
      if (authorizationFieldBytes(header) > maxHeaderBytes) {
        throw new RangeError("signed upload authorization header oversized");
      }
      for (const server of scope.servers) {
        const serverHeaders = headers.get(server) ?? new Map<string, string>();
        for (const hash of group) serverHeaders.set(hash, header);
        headers.set(server, serverHeaders);
      }
      eventCount++;
    }
  }
  return Object.freeze({
    expiration,
    eventCount,
    header: (server: string, hash: string) => headers.get(server)?.get(hash),
  });
}

function uploadTemplate(
  now: number,
  expiration: number,
  domain: string | undefined,
  hashes: readonly string[],
): EventTemplate {
  return {
    kind: 24242,
    created_at: now,
    content: "Upload Nix cache blobs",
    tags: [
      ["t", "upload"],
      ["expiration", String(expiration)],
      ...(domain ? [["server", domain]] : []),
      ...hashes.map((hash) => ["x", hash]),
    ],
  };
}
