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
  return parts.every((part) => part <= 255) ? parts : undefined;
}

export function isForbiddenAddress(address: string): boolean {
  const v4 = ipv4Parts(address.replace(/^::ffff:/i, ""));
  if (v4) {
    const [a, b, c] = v4;
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 0) ||
      (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113);
  }
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (!normalized.includes(":")) return true;
  return normalized === "::" || normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") || /^fe[89ab]/.test(normalized) ||
    normalized.startsWith("ff") || normalized.startsWith("2001:db8:");
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
  readonly #configuredOrigin?: string;

  constructor(resolver: Resolver = defaultResolver, configuredOrigin?: string) {
    this.#resolver = resolver;
    this.#configuredOrigin = configuredOrigin
      ? new URL(configuredOrigin).origin
      : undefined;
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
      this.#configuredOrigin === url.origin;
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
    options: { readonly signal: AbortSignal },
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
  contentLength?: number,
): ReadableStream<Uint8Array> {
  let remainder = initial;
  let emitted = 0;
  let closed = false;
  const close = () => {
    if (!closed) {
      closed = true;
      try {
        conn.close();
      } catch { /* already closed */ }
    }
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (contentLength !== undefined && emitted >= contentLength) {
        close();
        controller.close();
        return;
      }
      if (remainder.byteLength > 0) {
        const allowed = contentLength === undefined
          ? remainder.byteLength
          : Math.min(remainder.byteLength, contentLength - emitted);
        const chunk = remainder.slice(0, allowed);
        remainder = remainder.slice(allowed);
        emitted += chunk.byteLength;
        controller.enqueue(chunk);
        return;
      }
      const buffer = new Uint8Array(64 * 1024);
      const read = await conn.read(buffer);
      if (read === null) {
        close();
        if (contentLength !== undefined && emitted !== contentLength) {
          controller.error(new NetworkPolicyError("truncated response body"));
        } else controller.close();
        return;
      }
      const allowed = contentLength === undefined
        ? read
        : Math.min(read, contentLength - emitted);
      emitted += allowed;
      controller.enqueue(buffer.slice(0, allowed));
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
    options: { readonly signal: AbortSignal },
  ): Promise<PinnedResponse> {
    let conn: Deno.Conn = await Deno.connect({
      hostname: target.address,
      port: target.port,
      signal: options.signal,
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
      const request = new TextEncoder().encode(
        `GET ${
          path || "/"
        } HTTP/1.1\r\nHost: ${host}\r\nAccept: */*\r\nConnection: close\r\n\r\n`,
      );
      let offset = 0;
      while (offset < request.byteLength) {
        offset += await conn.write(request.subarray(offset));
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
      const lengthText = headers.get("content-length");
      const contentLength = lengthText === null
        ? undefined
        : Number(lengthText);
      if (
        contentLength !== undefined &&
        (!Number.isSafeInteger(contentLength) || contentLength < 0)
      ) throw new NetworkPolicyError("invalid Content-Length");
      options.signal.removeEventListener("abort", abort);
      return new SocketResponse(
        Number(statusMatch[1]),
        headers,
        responseBody(conn, remainder, contentLength),
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
      limits.totalTimeoutMs < limits.connectTimeoutMs
    ) throw new RangeError("invalid request deadlines");
  }

  async fetch(
    input: string | URL,
    trust: SourceTrust,
    signal?: AbortSignal,
  ): Promise<PinnedResponse> {
    const total = AbortSignal.timeout(this.limits.totalTimeoutMs);
    const totalSignal = signal ? AbortSignal.any([signal, total]) : total;
    let url = new URL(input);
    for (let hop = 0; hop <= this.limits.maxRedirects; hop++) {
      const target = await this.policy.approve(url, trust, totalSignal);
      const connect = AbortSignal.timeout(this.limits.connectTimeoutMs);
      const response = await this.transport.fetch(target, {
        signal: AbortSignal.any([totalSignal, connect]),
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) return response;
      const location = response.headers.get("location");
      await response.cancel("following redirect");
      if (!location) {
        throw new NetworkPolicyError(
          "redirect response has no Location header",
        );
      }
      url = new URL(location, url);
    }
    throw new NetworkPolicyError("redirect limit exceeded");
  }
}
