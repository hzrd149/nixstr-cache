import {
  BudgetExceeded,
  PathResolver,
  RequestBudget,
  VerifiedAbsent,
} from "../hashtree/reader.ts";
import type { SelectedPublication } from "../nostr/selection.ts";
import {
  classifyEndorsements,
  parseNarInfo,
  serializeNarInfo,
} from "../protocol/narinfo.ts";

export interface SelectionView {
  current(): SelectedPublication | undefined;
}

export interface NixHandlerDependencies {
  readonly selection: SelectionView;
  readonly resolverFor: (
    snapshot: SelectedPublication,
  ) => Pick<PathResolver, "resolve">;
  readonly budgetFor?: () => RequestBudget;
  readonly onEndorsements?: (
    snapshot: SelectedPublication,
    path: string,
    endorsed: number,
  ) => void;
}

const CACHE_INFO = "StoreDir: /nix/store\nWantMassQuery: 1\nPriority: 40\n";
const defaultBudget = () =>
  new RequestBudget({
    maxDepth: 32,
    maxLinks: 4096,
    maxUniqueNodes: 2048,
    maxDecodedBytes: 64 * 1024 * 1024,
    maxAttempts: 10,
    maxRedirects: 3,
    maxConcurrent: 8,
    deadline: Date.now() + 300_000,
  });

function text(body: string, method: string, status = 200): Response {
  const bytes = new TextEncoder().encode(body);
  return new Response(method === "HEAD" ? null : bytes, {
    status,
    headers: {
      "content-type": "text/x-nix-cache-info",
      "content-length": String(bytes.length),
    },
  });
}

function mapped(error: unknown): Response {
  if (error instanceof VerifiedAbsent) {
    return new Response("not found\n", { status: 404 });
  }
  if (
    error instanceof BudgetExceeded && /deadline|timeout/i.test(error.message)
  ) return new Response("upstream timeout\n", { status: 504 });
  return new Response("bad gateway\n", { status: 502 });
}

export function createNixHttpHandler(dependencies: NixHandlerDependencies) {
  return async (request: Request): Promise<Response> => {
    const snapshot = dependencies.selection.current();
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("method not allowed\n", {
        status: 405,
        headers: { allow: "GET, HEAD" },
      });
    }
    const pathname = new URL(request.url).pathname;
    if (pathname === "/nix-cache-info") return text(CACHE_INFO, request.method);
    const narinfoMatch = /^\/([0-9a-z]{32})\.narinfo$/.exec(pathname);
    const narMatch = /^\/(nar\/[A-Za-z0-9._+\/-]+)$/.exec(pathname);
    if (!narinfoMatch && !narMatch) {
      return new Response("not found\n", { status: 404 });
    }
    if (!snapshot) return new Response("cache unavailable\n", { status: 503 });
    const path = narinfoMatch ? `${narinfoMatch[1]}.narinfo` : narMatch![1];
    try {
      const resolved = await dependencies.resolverFor(snapshot).resolve(
        snapshot.root.hex,
        path,
        request.method,
        (dependencies.budgetFor ?? defaultBudget)(),
        request.signal,
      );
      if (request.method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: { "content-length": String(resolved.size) },
        });
      }
      if (!resolved.body) throw new Error("GET resolution omitted body");
      if (narinfoMatch) {
        const bytes = await new Response(resolved.body).bytes();
        const record = parseNarInfo(
          new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        );
        const endorsements = await classifyEndorsements(
          record,
          snapshot.nixSigKeys,
        );
        dependencies.onEndorsements?.(
          snapshot,
          path,
          endorsements.filter((value) => value.endorsed).length,
        );
        const body = serializeNarInfo(record);
        return text(body, request.method);
      }
      return new Response(resolved.body, {
        status: 200,
        headers: {
          "content-type": "application/x-nix-nar",
          "content-length": String(resolved.size),
        },
      });
    } catch (error) {
      return mapped(error);
    }
  };
}
