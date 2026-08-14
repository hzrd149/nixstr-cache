import type { PendingInventoryEntry } from "../persistence/write_repository.ts";
import type { PinnedResponse, SourceTrust } from "../network/safe_fetcher.ts";

export interface PublicationUploadBoundary {
  request(input: string | URL, trust: SourceTrust, init: {
    readonly method: "GET" | "HEAD" | "PUT";
    readonly headers?: Headers;
    readonly body?: ReadableStream<Uint8Array>;
    readonly signal?: AbortSignal;
  }): Promise<PinnedResponse>;
}

async function boundedJson(
  response: PinnedResponse,
  ceiling: number,
): Promise<unknown> {
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > ceiling) throw new RangeError("upload descriptor oversized");
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

export class PublicationUploader {
  constructor(
    readonly options: {
      readonly request: PublicationUploadBoundary["request"];
      readonly authorization?: (
        server: string,
        entry: PendingInventoryEntry,
        signal?: AbortSignal,
      ) => Promise<string>;
      readonly descriptorBytes?: number;
    },
  ) {}

  async prove(
    server: string,
    entry: PendingInventoryEntry,
    signal?: AbortSignal,
    trust: SourceTrust = "publisher",
  ): Promise<boolean> {
    signal?.throwIfAborted();
    const blobUrl = new URL(
      entry.hash,
      server.endsWith("/") ? server : `${server}/`,
    );
    let exists: PinnedResponse;
    try {
      exists = await this.options.request(blobUrl, trust, {
        method: "HEAD",
        signal,
      });
      await exists.cancel("existence preflight complete");
      if (exists.status === 200) {
        const length = exists.headers.get("content-length");
        return length !== null && /^(0|[1-9][0-9]*)$/.test(length) &&
          Number(length) === entry.size;
      }
      if (exists.status !== 404) return false;
    } catch {
      return false;
    }
    const headers = new Headers({
      "content-length": String(entry.size),
      "content-type": "application/octet-stream",
      "x-sha-256": entry.hash,
    });
    const authorization = await this.options.authorization?.(
      server,
      entry,
      signal,
    );
    if (authorization) headers.set("authorization", authorization);
    const file = await Deno.open(entry.path, { read: true });
    let response: PinnedResponse;
    try {
      response = await this.options.request(
        new URL("upload", server.endsWith("/") ? server : `${server}/`),
        trust,
        {
          method: "PUT",
          headers,
          body: file.readable,
          signal,
        },
      );
      if (response.status !== 200 && response.status !== 201) {
        await response.cancel("upload rejected");
        return false;
      }
      const descriptor = await boundedJson(
        response,
        this.options.descriptorBytes ?? 16 * 1024,
      ) as { sha256?: unknown; size?: unknown };
      return descriptor.sha256 === entry.hash && descriptor.size === entry.size;
    } catch {
      try {
        file.close();
      } catch { /* stream owns it */ }
      return false;
    }
  }
}
