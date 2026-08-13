import {
  BudgetExceeded,
  PathResolver,
  RequestBudget,
  VerifiedAbsent,
} from "../hashtree/reader.ts";
import type { SelectedPublication } from "../nostr/selection.ts";
import type { MergedSelectionSnapshot } from "../nostr/selection.ts";
import { classifyEndorsements, parseNarInfo } from "../protocol/narinfo.ts";
import type { SignerOverlay, SignerOverlaySnapshot } from "../write/overlay.ts";
import type { HealthSnapshotProvider } from "../operations/health.ts";
import type { OperationalDiagnosticSink } from "../operations/diagnostics.ts";
import { cacheIdentity } from "../protocol/publication.ts";
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
  readonly operationalDiagnostics?: OperationalDiagnosticSink;
  readonly routes?: WinnerRouteRegistry;
  readonly overlay?: Pick<SignerOverlay, "acquire" | "resolver"> & {
    current(): SignerOverlaySnapshot | undefined;
  };
  readonly health?: HealthSnapshotProvider;
  readonly write?: {
    current(): {
      readonly ready: boolean;
      readonly repository?: WriteRepository;
      readonly authorize?: () => Promise<void>;
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
  let closed = false;
  const emitOperational = (
    item: Parameters<OperationalDiagnosticSink["emit"]>[0],
  ) => {
    try {
      dependencies.operationalDiagnostics?.emit(item);
    } catch { /* diagnostics are non-authoritative */ }
  };
  const handleRequest = async (request: Request): Promise<Response> => {
    if (closed) return new Response("service unavailable\n", { status: 503 });
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
      try {
        await readiness.authorize?.();
      } catch {
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
        const routeClass = narinfoMatch ? "narinfo" as const : "nar" as const;
        if (error instanceof WriteConflict) {
          emitOperational({
            type: "staging_failure",
            code: "staging_conflict",
            routeClass,
            status: 409,
          });
          return new Response("immutable route conflict\n", { status: 409 });
        }
        if (error instanceof RangeError) {
          emitOperational({
            type: "staging_failure",
            code: "staging_too_large",
            routeClass,
            status: 413,
          });
          return new Response("payload too large\n", { status: 413 });
        }
        if (error instanceof TypeError) {
          emitOperational({
            type: "staging_failure",
            code: "staging_invalid_narinfo",
            routeClass,
            status: 400,
          });
          return new Response("invalid narinfo\n", { status: 400 });
        }
        emitOperational({
          type: "staging_failure",
          code: "staging_unavailable",
          routeClass,
          status: 503,
        });
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
      // Stock `nix copy --to` probes the destination before uploading. A
      // writable empty cache must report an absent route, not an unavailable
      // cache, or Nix aborts before issuing the first PUT.
      if (dependencies.write?.current().ready) {
        return new Response("not found\n", { status: 404 });
      }
      return new Response("cache unavailable\n", { status: 503 });
    }
    const path = narinfoMatch ? `${narinfoMatch[1]}.narinfo` : narMatch![1];
    let releaseOverlay: (() => void) | undefined;
    try {
      if (narinfoMatch) {
        const signerEntry = overlaySnapshot?.entries.get(path);
        if (signerEntry && overlaySnapshot) {
          const lease = dependencies.overlay!.acquire(
            overlaySnapshot.generation,
          );
          const resolved = await dependencies.overlay!.resolver(lease.snapshot)
            .resolve("", path, "GET");
          if (!resolved.body) throw new Error("GET resolution omitted body");
          const raw = await new Response(resolved.body).text();
          const record = parseNarInfo(raw);
          signerRoutes.set(record.url, lease);
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
        emitOperational({
          type: "cache_package",
          code: "narinfo_loaded",
          storePathHash: narinfoMatch[1],
          narPath: merged.record.url,
          winnerIdentity: cacheIdentity(merged.winner),
          providerIdentities: merged.providers.map(cacheIdentity),
        });
        return text(merged.text, request.method);
      }
      const budget = (dependencies.budgetFor ?? defaultBudget)();
      let resolved;
      const pinnedSigner = signerRoutes.take(path);
      if (pinnedSigner) {
        releaseOverlay = pinnedSigner.release;
        resolved = await dependencies.overlay!.resolver(pinnedSigner.snapshot)
          .resolve(
            "",
            path,
            request.method,
          );
      } else if (overlaySnapshot?.entries.has(path)) {
        const leased = dependencies.overlay!.acquire();
        releaseOverlay = leased.release;
        resolved = await dependencies.overlay!.resolver(leased.snapshot)
          .resolve("", path, request.method);
      }
      const pinned = routes.get(path);
      let servingPublication: SelectedPublication | undefined;
      let servingRoute: "pinned" | "fallback" = "fallback";
      if (!resolved && pinned) {
        resolved = await dependencies.resolverFor(pinned).resolve(
          pinned.root.hex,
          path,
          request.method,
          budget,
          request.signal,
        );
        servingPublication = pinned;
        servingRoute = "pinned";
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
            servingPublication = publication;
            break;
          } catch (error) {
            if (!(error instanceof VerifiedAbsent)) throw error;
          }
        }
        if (!resolved) throw new VerifiedAbsent(path);
      }
      if (servingPublication) {
        emitOperational({
          type: "hashtree_nar",
          code: "nar_served",
          method: request.method,
          path,
          cacheIdentity: cacheIdentity(servingPublication),
          rootHash: servingPublication.root.hex,
          eventId: servingPublication.event.id,
          route: servingRoute,
        });
      }
      if (request.method === "HEAD") {
        releaseOverlay?.();
        return new Response(null, {
          status: 200,
          headers: { "content-length": String(resolved.size) },
        });
      }
      if (!resolved.body) throw new Error("GET resolution omitted body");
      const body = releaseOverlay
        ? releaseOnTerminal(resolved.body, releaseOverlay)
        : resolved.body;
      return new Response(body, {
        status: 200,
        headers: {
          "content-type": "application/x-nix-nar",
          "content-length": String(resolved.size),
        },
      });
    } catch (error) {
      releaseOverlay?.();
      return mapped(error);
    }
  };
  const handler = async (request: Request): Promise<Response> => {
    const started = Date.now();
    let status = 500;
    let reasons: readonly string[] | undefined;
    try {
      const response = await handleRequest(request);
      status = response.status;
      if (status === 503 && dependencies.health) {
        const health = dependencies.health.current();
        reasons = [
          ...health.process.reasons,
          ...health.read.reasons,
          ...health.write.reasons,
        ];
      }
      return response;
    } finally {
      emitOperational({
        type: "http_request",
        code: "request_completed",
        method: request.method,
        path: new URL(request.url).pathname,
        status,
        durationMs: Math.max(0, Date.now() - started),
        reasons,
      });
    }
  };
  return Object.assign(handler, {
    close() {
      if (closed) return;
      closed = true;
      signerRoutes.close();
      routes.close();
    },
    [Symbol.dispose]() {
      this.close();
    },
  });
}

function releaseOnTerminal(
  body: ReadableStream<Uint8Array>,
  release: () => void,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    release();
  };
  return new ReadableStream({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) {
          finish();
          controller.close();
        } else controller.enqueue(next.value);
      } catch (error) {
        finish();
        controller.error(error);
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } finally {
        finish();
      }
    },
  });
}
