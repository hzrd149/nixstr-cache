import { NostrConnectSigner } from "applesauce-signers/signers/nostr-connect-signer";
import { PrivateKeySigner } from "applesauce-signers/signers/private-key-signer";
import { generateSecretKey, verifyEvent } from "nostr-tools";

export type NostrConnectOutcome = "success" | "mismatch" | "denied" | "failed";

interface RequestMessage {
  readonly id: string;
  readonly method: string;
  readonly params: string[];
}

export interface NostrConnectFixture {
  readonly relayUrl: string;
  readonly nbunksec: string;
  readonly facts: {
    readonly methods: string[];
    readonly permissions: string[];
    socketOpens: number;
    socketCloses: number;
    subscriptions: number;
  };
  readonly sensitiveValues: readonly string[];
  completeAuthorization(): Promise<void>;
  waitForRequests(count: number, timeoutMs: number): Promise<void>;
  waitForSocketClose(timeoutMs: number): Promise<void>;
  stagedFiles(path: string): Promise<string[]>;
  close(): Promise<void>;
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs: number,
  description: string,
) {
  const started = performance.now();
  while (!predicate()) {
    if (performance.now() - started >= timeoutMs) {
      throw new Error(`timed out waiting for ${description}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

export async function createNostrConnectFixture(options: {
  readonly outcome: NostrConnectOutcome;
  readonly returnedOwner: string;
}): Promise<NostrConnectFixture> {
  const remote = new PrivateKeySigner(generateSecretKey());
  const remotePubkey = await remote.getPublicKey();
  const clientKey = generateSecretKey();
  const clientKeyHex = clientKey.toHex();
  const bunkerSecret = `bunker-${crypto.randomUUID()}`;
  const authToken = `auth-${crypto.randomUUID()}`;
  const authUrl = `https://signer.invalid/authorize?token=${authToken}`;
  const rawError = `remote-denial-${crypto.randomUUID()}`;
  const facts = {
    methods: [] as string[],
    permissions: [] as string[],
    socketOpens: 0,
    socketCloses: 0,
    subscriptions: 0,
  };
  const ciphertexts: string[] = [];
  const sockets = new Set<WebSocket>();
  const subscriptions = new Map<WebSocket, string>();
  let pendingAuthorization:
    | { socket: WebSocket; clientPubkey: string; id: string }
    | undefined;

  const sendResponse = async (
    socket: WebSocket,
    clientPubkey: string,
    response: Record<string, string>,
  ) => {
    const content = await remote.nip44.encrypt(
      clientPubkey,
      JSON.stringify(response),
    );
    ciphertexts.push(content);
    const event = await remote.signEvent({
      kind: 24133,
      created_at: Math.floor(Date.now() / 1000),
      tags: [["p", clientPubkey]],
      content,
    });
    const subscription = subscriptions.get(socket);
    if (subscription && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(["EVENT", subscription, event]));
    }
  };

  const server = Deno.serve(
    { hostname: "127.0.0.1", port: 0, onListen: () => {} },
    (request) => {
      if (request.headers.get("upgrade") !== "websocket") {
        return new Response(null, { status: 426 });
      }
      const { socket, response } = Deno.upgradeWebSocket(request);
      socket.onopen = () => {
        sockets.add(socket);
        facts.socketOpens++;
      };
      socket.onclose = () => {
        sockets.delete(socket);
        subscriptions.delete(socket);
        facts.socketCloses++;
      };
      socket.onmessage = (message) => {
        void (async () => {
          const frame = JSON.parse(String(message.data));
          if (frame[0] === "REQ") {
            facts.subscriptions++;
            subscriptions.set(socket, String(frame[1]));
            socket.send(JSON.stringify(["EOSE", frame[1]]));
            return;
          }
          if (frame[0] === "CLOSE") {
            subscriptions.delete(socket);
            return;
          }
          if (frame[0] !== "EVENT") return;
          const event = frame[1];
          socket.send(JSON.stringify(["OK", event.id, true, ""]));
          if (!verifyEvent(event) || event.kind !== 24133) return;
          ciphertexts.push(event.content);
          const plaintext = await remote.nip44.decrypt(
            event.pubkey,
            event.content,
          );
          const request = JSON.parse(plaintext) as RequestMessage;
          facts.methods.push(request.method);
          if (request.method === "connect") {
            facts.permissions.push(request.params[2] ?? "");
            if (
              request.params[0] !== remotePubkey ||
              request.params[1] !== bunkerSecret
            ) {
              await sendResponse(socket, event.pubkey, {
                id: request.id,
                result: "denied",
                error: rawError,
              });
              return;
            }
            if (options.outcome === "failed" || options.outcome === "denied") {
              await sendResponse(socket, event.pubkey, {
                id: request.id,
                result: "ack",
              });
              return;
            }
            await sendResponse(socket, event.pubkey, {
              id: request.id,
              result: "auth_url",
              error: authUrl,
            });
            pendingAuthorization = {
              socket,
              clientPubkey: event.pubkey,
              id: request.id,
            };
          } else if (request.method === "get_public_key") {
            await sendResponse(socket, event.pubkey, {
              id: request.id,
              result:
                options.outcome === "denied" || options.outcome === "failed"
                  ? "invalid-remote-owner"
                  : options.returnedOwner,
            });
          }
        })();
      };
      return response;
    },
  );
  const address = server.addr as Deno.NetAddr;
  const relayUrl = `ws://127.0.0.1:${address.port}`;
  const nbunksec = NostrConnectSigner.createNbunksec({
    remote: remotePubkey,
    relays: [relayUrl],
    bunkerSecret,
    clientKey: clientKeyHex,
  });
  clientKey.fill(0);
  let closed = false;
  return {
    relayUrl,
    nbunksec,
    facts,
    get sensitiveValues() {
      return [
        nbunksec,
        clientKeyHex,
        bunkerSecret,
        authUrl,
        authToken,
        rawError,
        ...ciphertexts,
      ];
    },
    async completeAuthorization() {
      if (!pendingAuthorization) {
        throw new Error("authorization callback was not requested");
      }
      const pending = pendingAuthorization;
      pendingAuthorization = undefined;
      await sendResponse(
        pending.socket,
        pending.clientPubkey,
        { id: pending.id, result: "ack" },
      );
    },
    waitForRequests: (count, timeoutMs) =>
      waitUntil(
        () => facts.methods.length >= count,
        timeoutMs,
        `${count} NIP-46 requests (seen ${facts.methods.length})`,
      ),
    waitForSocketClose: (timeoutMs) =>
      waitUntil(
        () => facts.socketOpens > 0 && facts.socketCloses >= facts.socketOpens,
        timeoutMs,
        `NIP-46 socket close (opened ${facts.socketOpens}, closed ${facts.socketCloses}, methods ${
          facts.methods.join(",")
        })`,
      ),
    async stagedFiles(path) {
      const files: string[] = [];
      const walk = async (directory: string) => {
        try {
          for await (const entry of Deno.readDir(directory)) {
            const child = `${directory}/${entry.name}`;
            if (entry.isDirectory) await walk(child);
            else files.push(child.slice(path.length + 1));
          }
        } catch (error) {
          if (!(error instanceof Deno.errors.NotFound)) throw error;
        }
      };
      await walk(path);
      return files.sort();
    },
    async close() {
      if (closed) return;
      closed = true;
      for (const socket of sockets) socket.close();
      await server.shutdown();
      await server.finished;
    },
  };
}
