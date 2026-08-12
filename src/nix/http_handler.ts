import {
  BudgetExceeded,
  PathResolver,
  RequestBudget,
  VerifiedAbsent,
} from "../hashtree/reader.ts";
import type { SelectedPublication } from "../nostr/selection.ts";
import type { MergedSelectionSnapshot } from "../nostr/selection.ts";
import { classifyEndorsements, parseNarInfo } from "../protocol/narinfo.ts";
import type { SignerOverlay } from "../write/overlay.ts";
import type { HealthSnapshotProvider } from "../operations/health.ts";
import {
  WriteConflict,
  type WriteRepository,
} from "../persistence/write_repository.ts";
import {
  type DiagnosticSink,
  resolveMergedNarInfo,
  SignerRouteRegistry,
  WinnerRouteRegistry,
} from "./merged_cache.ts";

export interface SelectionView {
  current(): MergedSelectionSnapshot;
}

export interface NixHandlerDependencies {
  readonly decodedMetadataBytes: number;
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
  readonly diagnostics?: DiagnosticSink;
  readonly routes?: WinnerRouteRegistry;
  readonly overlay?: SignerOverlay;
  readonly health?: HealthSnapshotProvider;
  readonly write?: {
    current(): {
      readonly ready: boolean;
      readonly repository?: WriteRepository;
      readonly onStaged?: (route: string) => Promise<unknown>;
    };
  };
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
    maxBlobTransferBytes: 256 * 1024 * 1024,
    maxTransferredBytes: 1024 * 1024 * 1024,
    maxOutputBytes: 1024 * 1024 * 1024,
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
  const routes = dependencies.routes ??
    new WinnerRouteRegistry(1024, 5 * 60_000);
  const signerRoutes = new SignerRouteRegistry(1024, 5 * 60_000);
  return async (request: Request): Promise<Response> => {
    const pathname = new URL(request.url).pathname;
    if (
      pathname === "/health" &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      if (!dependencies.health) {
        return new Response("not found\n", { status: 404 });
      }
      const bytes = new TextEncoder().encode(
        JSON.stringify(dependencies.health.current()),
      );
      return new Response(request.method === "HEAD" ? null : bytes, {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-length": String(bytes.length),
        },
      });
    }
    const snapshot = dependencies.selection.current();
    const overlaySnapshot = dependencies.overlay?.current();
    if (request.method === "PUT") {
      const readiness = dependencies.write?.current();
      if (!readiness?.ready || !readiness.repository) {
        return new Response("method not allowed\n", {
          status: 405,
          headers: { allow: "GET, HEAD" },
        });
      }
      const url = new URL(request.url);
      if (
        url.search || url.hash || url.pathname.includes("%") ||
        request.body === null
      ) return new Response("not found\n", { status: 404 });
      if (
        (request.headers.get("content-encoding") ?? "identity")
          .toLowerCase() !== "identity"
      ) return new Response("unsupported content encoding\n", { status: 415 });
      const narinfoMatch = /^\/([0-9a-z]{32})\.narinfo$/.exec(url.pathname);
      const narMatch = /^\/(nar\/[A-Za-z0-9._+-]+)$/.exec(url.pathname);
      if (!narinfoMatch && !narMatch) {
        return new Response("not found\n", { status: 404 });
      }
      const route = narinfoMatch ? `${narinfoMatch[1]}.narinfo` : narMatch![1];
      try {
        const staged = await readiness.repository.stage(
          route,
          request.body,
          request.signal,
          narinfoMatch ? dependencies.decodedMetadataBytes : undefined,
        );
        if (narinfoMatch && !staged.idempotent) {
          const raw = await Deno.readTextFile(staged.path);
          try {
            const parsed = parseNarInfo(raw);
            if (
              parsed.storePath.slice(
                "/nix/store/".length,
                "/nix/store/".length + 32,
              ) !== narinfoMatch[1]
            ) throw new TypeError("narinfo route mismatch");
            readiness.repository.recordNarInfo(route, parsed);
          } catch (error) {
            readiness.repository.discard(route);
            throw error;
          }
        }
        await readiness.onStaged?.(route);
        return new Response(null, { status: 200 });
      } catch (error) {
        if (error instanceof WriteConflict) {
          return new Response("immutable route conflict\n", { status: 409 });
        }
        if (error instanceof RangeError) {
          return new Response("payload too large\n", { status: 413 });
        }
        if (error instanceof TypeError) {
          return new Response("invalid narinfo\n", { status: 400 });
        }
        return new Response("staging unavailable\n", { status: 503 });
      }
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("method not allowed\n", {
        status: 405,
        headers: { allow: "GET, HEAD" },
      });
    }
    if (pathname === "/nix-cache-info") return text(CACHE_INFO, request.method);
    const narinfoMatch = /^\/([0-9a-z]{32})\.narinfo$/.exec(pathname);
    const narMatch = /^\/(nar\/[A-Za-z0-9._+\/-]+)$/.exec(pathname);
    if (!narinfoMatch && !narMatch) {
      return new Response("not found\n", { status: 404 });
    }
    if (
      snapshot.length === 0 && !overlaySnapshot?.entries.has(pathname.slice(1))
    ) {
      return new Response("cache unavailable\n", { status: 503 });
    }
    const path = narinfoMatch ? `${narinfoMatch[1]}.narinfo` : narMatch![1];
    try {
      if (narinfoMatch) {
        const signerEntry = overlaySnapshot?.entries.get(path);
        if (signerEntry && overlaySnapshot) {
          const resolved = await dependencies.overlay!.resolver(overlaySnapshot)
            .resolve("", path, "GET");
          if (!resolved.body) throw new Error("GET resolution omitted body");
          const raw = await new Response(resolved.body).text();
          const record = parseNarInfo(raw);
          signerRoutes.set(record.url, overlaySnapshot);
          return text(raw, request.method);
        }
        const merged = await resolveMergedNarInfo({
          snapshot,
          path,
          storePathHash: narinfoMatch[1],
          budget: (dependencies.budgetFor ?? defaultBudget)(),
          signal: request.signal,
          decodedMetadataBytes: dependencies.decodedMetadataBytes,
          resolverFor: dependencies.resolverFor,
          diagnostics: dependencies.diagnostics,
        });
        const endorsements = await classifyEndorsements(
          merged.record,
          merged.winner.nixSigKeys,
        );
        dependencies.onEndorsements?.(
          merged.winner,
          path,
          endorsements.filter((value) => value.endorsed).length,
        );
        routes.set(merged.record.url, merged.winner);
        return text(merged.text, request.method);
      }
      const budget = (dependencies.budgetFor ?? defaultBudget)();
      let resolved;
      const pinnedSigner = signerRoutes.get(path);
      if (pinnedSigner) {
        resolved = await dependencies.overlay!.resolver(pinnedSigner).resolve(
          "",
          path,
          request.method,
        );
      } else if (overlaySnapshot?.entries.has(path)) {
        resolved = await dependencies.overlay!.resolver(overlaySnapshot)
          .resolve("", path, request.method);
      }
      const pinned = routes.get(path);
      if (!resolved && pinned) {
        resolved = await dependencies.resolverFor(pinned).resolve(
          pinned.root.hex,
          path,
          request.method,
          budget,
          request.signal,
        );
      } else if (!resolved) {
        for (const publication of snapshot) {
          try {
            resolved = await dependencies.resolverFor(publication).resolve(
              publication.root.hex,
              path,
              request.method,
              budget,
              request.signal,
            );
            break;
          } catch (error) {
            if (!(error instanceof VerifiedAbsent)) throw error;
          }
        }
        if (!resolved) throw new VerifiedAbsent(path);
      }
      if (request.method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: { "content-length": String(resolved.size) },
        });
      }
      if (!resolved.body) throw new Error("GET resolution omitted body");
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
