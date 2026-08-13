export type SourceTrust = "publisher" | "configured";
export type Resolver = (
  hostname: string,
  signal?: AbortSignal,
) => Promise<readonly string[]>;

export interface ApprovedTarget {
  readonly url: URL;
  readonly hostname: string;
  readonly address: string;
  readonly port: number;
}

export class NetworkPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkPolicyError";
  }
}

export class NetworkTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkTimeoutError";
  }
}

function ipv4Parts(address: string): number[] | undefined {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
  if (!match) return undefined;
  const parts = match.slice(1).map(Number);
  return parts.every((part, index) =>
      part <= 255 &&
      (match[index + 1] === "0" || !match[index + 1].startsWith("0"))
    )
    ? parts
    : undefined;
}

function parseIpv6(input: string): Uint8Array | undefined {
  if (input.includes("%") || input.includes("[") || input.includes("]")) return;
  let address = input.toLowerCase();
  let dotted: number[] | undefined;
  const lastColon = address.lastIndexOf(":");
  if (address.includes(".")) {
    if (lastColon < 0 || !(dotted = ipv4Parts(address.slice(lastColon + 1)))) {
      return;
    }
    address = `${address.slice(0, lastColon)}:${
      ((dotted[0] << 8) | dotted[1]).toString(16)
    }:${((dotted[2] << 8) | dotted[3]).toString(16)}`;
  }
  if ((address.match(/::/g) ?? []).length > 1) return;
  const halves = address.split("::");
  const parseHalf = (value: string): number[] | undefined => {
    if (!value) return [];
    const words = value.split(":");
    if (words.some((word) => !/^[0-9a-f]{1,4}$/.test(word))) return;
    return words.map((word) => Number.parseInt(word, 16));
  };
  const left = parseHalf(halves[0]);
  const right = parseHalf(halves[1] ?? "");
  if (!left || !right) return;
  const missing = 8 - left.length - right.length;
  if (
    (halves.length === 1 && missing !== 0) ||
    (halves.length === 2 && missing < 1)
  ) return;
  const words = [...left, ...Array(missing).fill(0), ...right];
  if (words.length !== 8) return;
  const bytes = new Uint8Array(16);
  words.forEach((word, index) => {
    bytes[index * 2] = word >>> 8;
    bytes[index * 2 + 1] = word & 0xff;
  });
  return bytes;
}

function inCidr(
  bytes: Uint8Array,
  prefix: Uint8Array | readonly number[],
  bits: number,
): boolean {
  for (let bit = 0; bit < bits; bit++) {
    if (
      ((bytes[bit >>> 3] >>> (7 - (bit & 7))) & 1) !==
        ((prefix[bit >>> 3] >>> (7 - (bit & 7))) & 1)
    ) return false;
  }
  return true;
}

const V4_FORBIDDEN: ReadonlyArray<readonly [readonly number[], number]> = [
  [[0, 0, 0, 0], 8],
  [[10, 0, 0, 0], 8],
  [[100, 64, 0, 0], 10],
  [[127, 0, 0, 0], 8],
  [[169, 254, 0, 0], 16],
  [[172, 16, 0, 0], 12],
  [[192, 0, 0, 0], 24],
  [[192, 0, 2, 0], 24],
  [[192, 168, 0, 0], 16],
  [[198, 18, 0, 0], 15],
  [[198, 51, 100, 0], 24],
  [[203, 0, 113, 0], 24],
  [[224, 0, 0, 0], 4],
  [[240, 0, 0, 0], 4],
];

export function isForbiddenAddress(address: string): boolean {
  const v4 = ipv4Parts(address);
  if (v4) {
    return V4_FORBIDDEN.some(([prefix, bits]) =>
      inCidr(new Uint8Array(v4), prefix, bits)
    );
  }
  const v6 = parseIpv6(address);
  if (!v6) return true;
  if (
    v6.slice(0, 10).every((byte) => byte === 0) && v6[10] === 0xff &&
    v6[11] === 0xff
  ) {
    const mapped = v6.slice(12);
    return V4_FORBIDDEN.some(([prefix, bits]) => inCidr(mapped, prefix, bits));
  }
  const cidrs: ReadonlyArray<readonly [string, number]> = [
    ["::", 128],
    ["::1", 128],
    ["64:ff9b:1::", 48],
    ["100::", 64],
    ["2001::", 23],
    ["2001:db8::", 32],
    ["fc00::", 7],
    ["fe80::", 10],
    ["ff00::", 8],
  ];
  return cidrs.some(([prefix, bits]) => inCidr(v6, parseIpv6(prefix)!, bits));
}

async function defaultResolver(
  hostname: string,
  signal?: AbortSignal,
): Promise<readonly string[]> {
  if (ipv4Parts(hostname) || hostname.includes(":")) return [hostname];
  const lookups = await Promise.allSettled([
    Deno.resolveDns(hostname, "A", { signal }),
    Deno.resolveDns(hostname, "AAAA", { signal }),
  ]);
  return lookups.flatMap((result) =>
    result.status === "fulfilled" ? result.value : []
  );
}

export class AddressPolicy {
  readonly #resolver: Resolver;
  readonly #configuredOrigins: ReadonlySet<string>;

  constructor(
    resolver: Resolver = defaultResolver,
    configuredOrigin?: string | readonly string[],
  ) {
    this.#resolver = resolver;
    this.#configuredOrigins = new Set(
      (typeof configuredOrigin === "string"
        ? [configuredOrigin]
        : configuredOrigin ?? []).map((value) => new URL(value).origin),
    );
  }

  async approve(
    url: URL,
    trust: SourceTrust,
    signal?: AbortSignal,
  ): Promise<ApprovedTarget> {
    if (!(url.protocol === "http:" || url.protocol === "https:")) {
      throw new NetworkPolicyError("only HTTP(S) targets are allowed");
    }
    if (url.username || url.password) {
      throw new NetworkPolicyError("target userinfo is forbidden");
    }
    const configuredLocal = trust === "configured" &&
      this.#configuredOrigins.has(url.origin);
    if (trust === "configured" && !configuredLocal) {
      throw new NetworkPolicyError(
        "configured trust applies only to the configured origin",
      );
    }
    const answers = [...new Set(await this.#resolver(url.hostname, signal))];
    if (answers.length === 0) {
      throw new NetworkPolicyError("target hostname returned no addresses");
    }
    if (!configuredLocal && answers.some(isForbiddenAddress)) {
      throw new NetworkPolicyError(
        "target DNS answer set contains a forbidden address",
      );
    }
    return Object.freeze({
      url: new URL(url.href),
      hostname: url.hostname,
      address: answers[0],
      port: url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80,
    });
  }
}

export interface PinnedResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly body: ReadableStream<Uint8Array>;
  readonly peerAddress: string;
  text(): Promise<string>;
  cancel(reason?: unknown): Promise<void>;
}

export interface Transport {
  fetch(
    target: ApprovedTarget,
    options: {
      readonly signal: AbortSignal;
      readonly connectSignal?: AbortSignal;
      readonly idleTimeoutMs?: number;
      readonly method?: "GET" | "PUT";
      readonly headers?: Headers;
      readonly body?: ReadableStream<Uint8Array>;
    },
  ): Promise<PinnedResponse>;
}

class SocketResponse implements PinnedResponse {
  constructor(
    readonly status: number,
    readonly headers: Headers,
    readonly body: ReadableStream<Uint8Array>,
    readonly peerAddress: string,
  ) {}

  async text(): Promise<string> {
    return await new Response(this.body).text();
  }

  async cancel(reason?: unknown): Promise<void> {
    await this.body.cancel(reason);
  }
}

function joinChunks(
  chunks: Uint8Array<ArrayBufferLike>[],
): Uint8Array<ArrayBufferLike> {
  const size = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function readHeaders(
  conn: Deno.Conn,
): Promise<{ head: Uint8Array; remainder: Uint8Array }> {
  const chunks: Uint8Array<ArrayBufferLike>[] = [];
  let aggregate: Uint8Array<ArrayBufferLike> = new Uint8Array();
  while (aggregate.byteLength <= 64 * 1024) {
    const buffer = new Uint8Array(4096);
    const read = await conn.read(buffer);
    if (read === null) {
      throw new NetworkPolicyError("connection closed before response headers");
    }
    chunks.push(buffer.slice(0, read));
    aggregate = joinChunks(chunks);
    for (
      let index = Math.max(0, aggregate.byteLength - read - 3);
      index <= aggregate.byteLength - 4;
      index++
    ) {
      if (
        aggregate[index] === 13 && aggregate[index + 1] === 10 &&
        aggregate[index + 2] === 13 && aggregate[index + 3] === 10
      ) {
        return {
          head: aggregate.slice(0, index),
          remainder: aggregate.slice(index + 4),
        };
      }
    }
  }
  throw new NetworkPolicyError("response headers exceed 64 KiB");
}

function responseBody(
  conn: Deno.Conn,
  initial: Uint8Array,
  framing: { readonly kind: "length"; readonly length: number } | {
    readonly kind: "chunked";
  },
  signal: AbortSignal,
  idleTimeoutMs: number,
  cleanup: () => void,
): ReadableStream<Uint8Array> {
  let remainder = initial;
  let emitted = 0;
  let closed = false;
  let chunkRemaining = 0;
  let chunkDone = false;
  const close = () => {
    if (!closed) {
      closed = true;
      try {
        conn.close();
      } catch { /* already closed */ }
      cleanup();
    }
  };
  const readMore = async (): Promise<void> => {
    const buffer = new Uint8Array(64 * 1024);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const idle = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new NetworkTimeoutError("response body idle deadline exceeded"),
          ),
        idleTimeoutMs,
      );
    });
    try {
      const read = await Promise.race([conn.read(buffer), idle]);
      if (read === null) {
        throw new NetworkPolicyError("premature EOF in response body");
      }
      remainder = joinChunks([remainder, buffer.slice(0, read)]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };
  const takeLine = async (ceiling: number): Promise<string> => {
    while (true) {
      for (let i = 0; i + 1 < remainder.length; i++) {
        if (remainder[i] === 13 && remainder[i + 1] === 10) {
          if (i > ceiling) {
            throw new NetworkPolicyError("chunk framing line too long");
          }
          const line = new TextDecoder().decode(remainder.slice(0, i));
          remainder = remainder.slice(i + 2);
          return line;
        }
      }
      if (remainder.length > ceiling) {
        throw new NetworkPolicyError("chunk framing line too long");
      }
      await readMore();
    }
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (signal.aborted) {
          throw signal.reason ??
            new NetworkTimeoutError("request deadline exceeded");
        }
        if (framing.kind === "length") {
          if (emitted >= framing.length) {
            close();
            controller.close();
            return;
          }
          if (remainder.length === 0) await readMore();
          const allowed = Math.min(remainder.length, framing.length - emitted);
          const chunk = remainder.slice(0, allowed);
          remainder = remainder.slice(allowed);
          emitted += allowed;
          controller.enqueue(chunk);
          return;
        }
        if (chunkDone) {
          close();
          controller.close();
          return;
        }
        if (chunkRemaining === 0) {
          const sizeLine = await takeLine(4096);
          const token = sizeLine.split(";", 1)[0];
          if (!/^[0-9a-fA-F]+$/.test(token)) {
            throw new NetworkPolicyError("invalid chunk size");
          }
          chunkRemaining = Number.parseInt(token, 16);
          if (!Number.isSafeInteger(chunkRemaining)) {
            throw new NetworkPolicyError("invalid chunk size");
          }
          if (chunkRemaining === 0) {
            let trailerBytes = 0;
            while (true) {
              const trailer = await takeLine(8192);
              trailerBytes += trailer.length + 2;
              if (trailerBytes > 32 * 1024) {
                throw new NetworkPolicyError("chunk trailers too large");
              }
              if (!trailer) break;
              if (
                !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+:[\t\x20-\x7e]*$/.test(trailer)
              ) throw new NetworkPolicyError("malformed chunk trailer");
              if (
                /^(content-length|transfer-encoding|host|trailer):/i.test(
                  trailer,
                )
              ) throw new NetworkPolicyError("forbidden chunk trailer field");
            }
            chunkDone = true;
            close();
            controller.close();
            return;
          }
        }
        if (remainder.length === 0) await readMore();
        const allowed = Math.min(remainder.length, chunkRemaining);
        const chunk = remainder.slice(0, allowed);
        remainder = remainder.slice(allowed);
        chunkRemaining -= allowed;
        if (chunkRemaining === 0) {
          while (remainder.length < 2) await readMore();
          if (remainder[0] !== 13 || remainder[1] !== 10) {
            throw new NetworkPolicyError("invalid chunk delimiter");
          }
          remainder = remainder.slice(2);
        }
        controller.enqueue(chunk);
      } catch (error) {
        close();
        controller.error(error);
      }
    },
    cancel() {
      close();
    },
  });
}

export class PinnedTransport implements Transport {
  readonly #caCerts?: readonly string[];

  constructor(options: { readonly caCerts?: readonly string[] } = {}) {
    this.#caCerts = options.caCerts;
  }

  async fetch(
    target: ApprovedTarget,
    options: {
      readonly signal: AbortSignal;
      readonly connectSignal?: AbortSignal;
      readonly idleTimeoutMs?: number;
      readonly method?: "GET" | "PUT";
      readonly headers?: Headers;
      readonly body?: ReadableStream<Uint8Array>;
    },
  ): Promise<PinnedResponse> {
    let conn: Deno.Conn = await Deno.connect({
      hostname: target.address,
      port: target.port,
      signal: options.connectSignal ?? options.signal,
    });
    const abort = () => {
      try {
        conn.close();
      } catch { /* closed */ }
    };
    options.signal.addEventListener("abort", abort, { once: true });
    try {
      if (target.url.protocol === "https:") {
        conn = await Deno.startTls(conn as Deno.TcpConn, {
          hostname: target.hostname,
          caCerts: this.#caCerts ? [...this.#caCerts] : undefined,
          alpnProtocols: ["http/1.1"],
        });
      }
      const defaultPort = target.url.protocol === "https:" ? 443 : 80;
      const host = target.port === defaultPort
        ? target.hostname
        : `${target.hostname}:${target.port}`;
      const path = `${target.url.pathname}${target.url.search}`;
      const method = options.method ?? "GET";
      const requestHeaders = new Headers(options.headers);
      requestHeaders.delete("host");
      requestHeaders.delete("connection");
      if (!requestHeaders.has("accept")) requestHeaders.set("accept", "*/*");
      const headerLines = [...requestHeaders.entries()].map(([name, value]) =>
        `${name}: ${value}\r\n`
      ).join("");
      const request = new TextEncoder().encode(
        `${method} ${
          path || "/"
        } HTTP/1.1\r\nHost: ${host}\r\n${headerLines}Connection: close\r\n\r\n`,
      );
      let offset = 0;
      while (offset < request.byteLength) {
        offset += await conn.write(request.subarray(offset));
      }
      if (options.body) {
        const reader = options.body.getReader();
        try {
          while (true) {
            const next = await reader.read();
            if (next.done) break;
            let bodyOffset = 0;
            while (bodyOffset < next.value.byteLength) {
              bodyOffset += await conn.write(next.value.subarray(bodyOffset));
            }
          }
        } catch (error) {
          await reader.cancel(error).catch(() => {});
          throw error;
        } finally {
          reader.releaseLock();
        }
      }
      const { head, remainder } = await readHeaders(conn);
      const lines = new TextDecoder().decode(head).split("\r\n");
      const statusMatch = /^HTTP\/1\.[01] (\d{3})(?: |$)/.exec(
        lines.shift() ?? "",
      );
      if (!statusMatch) {
        throw new NetworkPolicyError("malformed HTTP status line");
      }
      const headers = new Headers();
      for (const line of lines) {
        const colon = line.indexOf(":");
        if (colon <= 0) {
          throw new NetworkPolicyError("malformed HTTP response header");
        }
        headers.append(
          line.slice(0, colon).trim(),
          line.slice(colon + 1).trim(),
        );
      }
      const rawLengths = lines.filter((line) =>
        /^content-length\s*:/i.test(line)
      ).map((line) => line.slice(line.indexOf(":") + 1).trim());
      const transfer = headers.get("transfer-encoding");
      if (transfer !== null && rawLengths.length) {
        throw new NetworkPolicyError(
          "Transfer-Encoding with Content-Length is forbidden",
        );
      }
      if (
        rawLengths.length > 1 || rawLengths.some((value) => value.includes(","))
      ) throw new NetworkPolicyError("duplicate Content-Length is forbidden");
      let framing: { kind: "length"; length: number } | { kind: "chunked" };
      if (transfer !== null) {
        const codings = transfer.split(",").map((x) => x.trim().toLowerCase());
        if (codings.length !== 1 || codings[0] !== "chunked") {
          throw new NetworkPolicyError("unsupported Transfer-Encoding");
        }
        framing = { kind: "chunked" };
      } else {
        if (
          rawLengths.length !== 1 || !/^(0|[1-9][0-9]*)$/.test(rawLengths[0])
        ) {
          throw new NetworkPolicyError(
            "exactly one valid Content-Length is required",
          );
        }
        const length = Number(rawLengths[0]);
        if (!Number.isSafeInteger(length)) {
          throw new NetworkPolicyError("invalid Content-Length");
        }
        framing = { kind: "length", length };
      }
      const cleanup = () => options.signal.removeEventListener("abort", abort);
      return new SocketResponse(
        Number(statusMatch[1]),
        headers,
        responseBody(
          conn,
          remainder,
          framing,
          options.signal,
          options.idleTimeoutMs ?? 30_000,
          cleanup,
        ),
        target.address,
      );
    } catch (error) {
      abort();
      if (options.signal.aborted) {
        throw new NetworkTimeoutError("pinned request deadline exceeded");
      }
      throw error;
    }
  }
}

export interface SafeFetcherLimits {
  readonly maxRedirects: number;
  readonly connectTimeoutMs: number;
  readonly totalTimeoutMs: number;
  readonly idleTimeoutMs?: number;
}

export class SafeFetcher {
  constructor(
    readonly policy: AddressPolicy,
    readonly transport: Transport,
    readonly limits: SafeFetcherLimits,
  ) {
    if (
      !Number.isInteger(limits.maxRedirects) || limits.maxRedirects < 0 ||
      limits.maxRedirects > 8
    ) throw new RangeError("maxRedirects must be between 0 and 8");
    if (
      limits.connectTimeoutMs <= 0 ||
      limits.totalTimeoutMs < limits.connectTimeoutMs ||
      (limits.idleTimeoutMs !== undefined && limits.idleTimeoutMs <= 0)
    ) throw new RangeError("invalid request deadlines");
  }

  async fetch(
    input: string | URL,
    trust: SourceTrust,
    signal?: AbortSignal,
  ): Promise<PinnedResponse> {
    return await this.request(input, trust, { method: "GET", signal });
  }

  async request(
    input: string | URL,
    trust: SourceTrust,
    init: {
      readonly method: "GET" | "PUT";
      readonly headers?: Headers;
      readonly body?: ReadableStream<Uint8Array>;
      readonly signal?: AbortSignal;
    },
  ): Promise<PinnedResponse> {
    const total = AbortSignal.timeout(this.limits.totalTimeoutMs);
    const totalSignal = init.signal
      ? AbortSignal.any([init.signal, total])
      : total;
    let url = new URL(input);
    for (let hop = 0; hop <= this.limits.maxRedirects; hop++) {
      const target = await this.policy.approve(url, trust, totalSignal);
      const connect = AbortSignal.timeout(this.limits.connectTimeoutMs);
      const response = await this.transport.fetch(target, {
        signal: totalSignal,
        connectSignal: AbortSignal.any([totalSignal, connect]),
        idleTimeoutMs: this.limits.idleTimeoutMs,
        method: init.method,
        headers: init.headers,
        body: init.body,
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) return response;
      const location = response.headers.get("location");
      await response.cancel("following redirect");
      if (!location) {
        throw new NetworkPolicyError(
          "redirect response has no Location header",
        );
      }
      if (init.method !== "GET") {
        throw new NetworkPolicyError("upload redirects are forbidden");
      }
      const redirect = new URL(location, url);
      url = redirect;
    }
    throw new NetworkPolicyError("redirect limit exceeded");
  }
}
