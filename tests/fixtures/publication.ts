import { assertEquals } from "@std/assert";
import { sha256 } from "@noble/hashes/sha2.js";
import type { RawPublication } from "../../src/protocol/publication.ts";

export interface PublicationFixture {
  readonly blossomUrl: string;
  readonly relayUrl: string;
  readonly blobCount: number;
  readonly uploadedHashes: readonly string[];
  readonly publishedEvents: readonly RawPublication[];
  waitForPublication(timeoutMs: number): Promise<RawPublication>;
  close(): Promise<void>;
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

export async function createPublicationFixture(): Promise<PublicationFixture> {
  const blobs = new Map<string, Uint8Array>();
  const uploadedHashes: string[] = [];
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
        const bytes = new Uint8Array(await request.arrayBuffer());
        assertEquals(bytes.length, declared);
        assertEquals(sha256(bytes).toHex(), expected);
        blobs.set(expected, bytes);
        uploadedHashes.push(expected);
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
