import { assertEquals } from "@std/assert";
import { sha256 } from "@noble/hashes/sha2.js";
import { verifyEvent } from "nostr-tools";
import type { RawPublication } from "../../src/protocol/publication.ts";
import type { PinnedResponse } from "../../src/network/safe_fetcher.ts";

export interface PublicationFixture {
  readonly blossomUrl: string;
  readonly relayUrl: string;
  readonly blobCount: number;
  readonly uploadedHashes: readonly string[];
  readonly uploadAuthorizations: readonly RawPublication[];
  readonly publishedEvents: readonly RawPublication[];
  waitForPublication(timeoutMs: number): Promise<RawPublication>;
  close(): Promise<void>;
}

function decodeNostrAuthorization(value: string | null):
  | RawPublication
  | undefined {
  const encoded = /^Nostr ([A-Za-z0-9_-]+)$/.exec(value ?? "")?.[1];
  if (!encoded) return undefined;
  try {
    const base64 = encoded.replaceAll("-", "+").replaceAll("_", "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const bytes = Uint8Array.from(
      atob(padded),
      (character) => character.charCodeAt(0),
    );
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return undefined;
  }
}

function waitUntil<T>(
  read: () => T | undefined,
  timeoutMs: number,
  description: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const poll = () => {
      const value = read();
      if (value !== undefined) return resolve(value);
      if (performance.now() - started >= timeoutMs) {
        return reject(new Error(`timed out waiting for ${description}`));
      }
      setTimeout(poll, 10);
    };
    poll();
  });
}

export function createPublicationFixture(): PublicationFixture {
  const blobs = new Map<string, Uint8Array>();
  const uploadedHashes: string[] = [];
  const uploadAuthorizations: RawPublication[] = [];
  const publishedEvents: RawPublication[] = [];
  const sockets = new Set<WebSocket>();
  const subscriptions = new Map<WebSocket, string>();
  const blossom = Deno.serve(
    { hostname: "127.0.0.1", port: 0, onListen: () => {} },
    async (request) => {
      const pathname = new URL(request.url).pathname;
      if (request.method === "PUT" && pathname === "/upload") {
        const expected = request.headers.get("x-sha-256");
        const declared = Number(request.headers.get("content-length"));
        if (!expected || !/^[0-9a-f]{64}$/.test(expected)) {
          return new Response(null, { status: 400 });
        }
        const authorization = decodeNostrAuthorization(
          request.headers.get("authorization"),
        );
        const now = Math.floor(Date.now() / 1000);
        if (
          !authorization || !verifyEvent(authorization) ||
          authorization.kind !== 24242 ||
          authorization.created_at > now ||
          authorization.content.trim().length === 0 ||
          !authorization.tags.some((tag) =>
            tag[0] === "t" && tag[1] === "upload"
          ) ||
          !authorization.tags.some((tag) =>
            tag[0] === "expiration" && Number(tag[1]) > now
          ) ||
          !authorization.tags.some((tag) =>
            tag[0] === "x" && tag[1] === expected
          )
        ) {
          return new Response("invalid BUD-11 upload authorization", {
            status: 401,
          });
        }
        const bytes = new Uint8Array(await request.arrayBuffer());
        assertEquals(bytes.length, declared);
        assertEquals(sha256(bytes).toHex(), expected);
        blobs.set(expected, bytes);
        uploadedHashes.push(expected);
        uploadAuthorizations.push(authorization);
        const descriptor = JSON.stringify({
          sha256: expected,
          size: bytes.length,
        });
        return new Response(descriptor, {
          status: 201,
          headers: {
            "content-length": String(
              new TextEncoder().encode(descriptor).length,
            ),
          },
        });
      }
      if (request.method === "GET") {
        const body = blobs.get(pathname.slice(1));
        return body
          ? new Response(body.slice(), {
            headers: { "content-length": String(body.length) },
          })
          : new Response(null, { status: 404 });
      }
      return new Response(null, { status: 405 });
    },
  );
  const blossomUrl = `http://127.0.0.1:${(blossom.addr as Deno.NetAddr).port}`;
  const relay = Deno.serve(
    { hostname: "127.0.0.1", port: 0, onListen: () => {} },
    (request) => {
      if (request.headers.get("upgrade") !== "websocket") {
        return new Response(null, { status: 426 });
      }
      const { socket, response } = Deno.upgradeWebSocket(request);
      socket.onopen = () => sockets.add(socket);
      socket.onclose = () => {
        sockets.delete(socket);
        subscriptions.delete(socket);
      };
      socket.onmessage = (message) => {
        const frame = JSON.parse(String(message.data));
        if (frame[0] === "REQ") {
          subscriptions.set(socket, String(frame[1]));
          for (const event of publishedEvents) {
            socket.send(JSON.stringify(["EVENT", frame[1], event]));
          }
          socket.send(JSON.stringify(["EOSE", frame[1]]));
        } else if (frame[0] === "CLOSE") {
          subscriptions.delete(socket);
        } else if (frame[0] === "EVENT") {
          const event = frame[1] as RawPublication;
          publishedEvents.push(event);
          socket.send(JSON.stringify(["OK", event.id, true, "saved"]));
          for (const [subscriber, id] of subscriptions) {
            if (subscriber.readyState === WebSocket.OPEN) {
              subscriber.send(JSON.stringify(["EVENT", id, event]));
            }
          }
        }
      };
      return response;
    },
  );
  const relayUrl = `ws://127.0.0.1:${(relay.addr as Deno.NetAddr).port}`;
  return {
    blossomUrl,
    relayUrl,
    get blobCount() {
      return blobs.size;
    },
    get uploadedHashes() {
      return Object.freeze([...uploadedHashes]);
    },
    get uploadAuthorizations() {
      return Object.freeze([...uploadAuthorizations]);
    },
    get publishedEvents() {
      return Object.freeze([...publishedEvents]);
    },
    waitForPublication: (timeoutMs) =>
      waitUntil(() => publishedEvents[0], timeoutMs, "signed publication"),
    async close() {
      for (const socket of sockets) socket.close();
      await Promise.all([relay.shutdown(), blossom.shutdown()]);
    },
  };
}

export type BlossomMode =
  | "ok"
  | "descriptor-hash"
  | "descriptor-size"
  | "truncated-proof"
  | "false-possession";

export function createControlledBlossomFixture(
  options: { readonly throttleMs?: number } = {},
) {
  const blobs = new Map<string, Uint8Array>();
  const control: { mode: BlossomMode } = { mode: "ok" };
  const facts = { activeUploads: 0, maxActiveUploads: 0, uploadChunks: 0 };
  const server = Deno.serve(
    { hostname: "127.0.0.1", port: 0, onListen: () => {} },
    async (request) => {
      const path = new URL(request.url).pathname;
      if (request.method === "PUT" && path === "/upload") {
        facts.activeUploads++;
        facts.maxActiveUploads = Math.max(
          facts.maxActiveUploads,
          facts.activeUploads,
        );
        try {
          const chunks: Uint8Array[] = [];
          let size = 0;
          const reader = request.body!.getReader();
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            facts.uploadChunks++;
            chunks.push(part.value);
            size += part.value.length;
            if (options.throttleMs) {
              await new Promise((resolve) =>
                setTimeout(resolve, options.throttleMs)
              );
            }
          }
          const bytes = new Uint8Array(size);
          let offset = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.length;
          }
          const hash = request.headers.get("x-sha-256")!;
          blobs.set(hash, bytes);
          const descriptor = JSON.stringify({
            sha256: control.mode === "descriptor-hash" ? "0".repeat(64) : hash,
            size: control.mode === "descriptor-size" ? size + 1 : size,
          });
          return new Response(descriptor, { status: 201 });
        } finally {
          facts.activeUploads--;
        }
      }
      if (request.method === "GET") {
        if (control.mode === "false-possession") {
          return new Response(null, { status: 404 });
        }
        const body = blobs.get(path.slice(1));
        if (!body) return new Response(null, { status: 404 });
        return new Response(
          control.mode === "truncated-proof" ? body.slice(0, -1) : body.slice(),
        );
      }
      return new Response(null, { status: 405 });
    },
  );
  const url = `http://127.0.0.1:${(server.addr as Deno.NetAddr).port}`;
  const request = async (
    input: string | URL,
    _trust: unknown,
    init: {
      method: "GET" | "PUT";
      headers?: Headers;
      body?: ReadableStream<Uint8Array>;
      signal?: AbortSignal;
    },
  ): Promise<PinnedResponse> => {
    const response = await fetch(
      input,
      { ...init, duplex: init.body ? "half" : undefined } as RequestInit,
    );
    const body = response.body ??
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close();
        },
      });
    return {
      status: response.status,
      headers: response.headers,
      body,
      peerAddress: "127.0.0.1",
      text: () => response.text(),
      cancel: async (reason) => {
        await body.cancel(reason).catch(() => {});
      },
    };
  };
  return { url, control, facts, request, close: () => server.shutdown() };
}

export type RelayMode =
  | "true"
  | "false"
  | "foreign"
  | "absent"
  | "duplicate-true";

export function createControlledRelayFixture() {
  const control: { mode: RelayMode } = { mode: "true" };
  const facts = { eventIds: [] as string[] };
  const sockets = new Set<WebSocket>();
  const server = Deno.serve(
    { hostname: "127.0.0.1", port: 0, onListen: () => {} },
    (request) => {
      const { socket, response } = Deno.upgradeWebSocket(request);
      socket.onopen = () => sockets.add(socket);
      socket.onclose = () => sockets.delete(socket);
      socket.onmessage = (message) => {
        const frame = JSON.parse(String(message.data));
        if (frame[0] !== "EVENT") return;
        const event = frame[1] as RawPublication;
        facts.eventIds.push(event.id);
        if (control.mode === "absent") return;
        const id = control.mode === "foreign" ? "f".repeat(64) : event.id;
        const ok = control.mode !== "false";
        socket.send(JSON.stringify(["OK", id, ok, ok ? "saved" : "rejected"]));
        if (control.mode === "duplicate-true") {
          socket.send(JSON.stringify(["OK", id, true, "duplicate"]));
        }
      };
      return response;
    },
  );
  const url = `ws://127.0.0.1:${(server.addr as Deno.NetAddr).port}`;
  const publish = (event: RawPublication, timeoutMs: number) =>
    new Promise<boolean>((resolve) => {
      const socket = new WebSocket(url);
      let settled = false;
      const finish = (value: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.close();
        resolve(value);
      };
      const timer = setTimeout(() => finish(false), timeoutMs);
      socket.onopen = () => socket.send(JSON.stringify(["EVENT", event]));
      socket.onmessage = (message) => {
        const frame = JSON.parse(String(message.data));
        if (frame[0] === "OK" && frame[1] === event.id && frame[2] === true) {
          finish(true);
        }
      };
      socket.onerror = () => finish(false);
    });
  return {
    url,
    control,
    facts,
    publish,
    async close() {
      for (const socket of sockets) socket.close();
      await server.shutdown();
    },
  };
}
