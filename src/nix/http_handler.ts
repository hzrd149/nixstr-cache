import {
  BudgetExceeded,
  NarResolutionFailed,
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
import {
  debugEndpoint,
  debugHttpRequest,
  debugHttpRoute,
  debugPath,
  inboundRequestId,
} from "../operations/debug.ts";
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

function textError(
  body: string,
  method: string,
  status: number,
  headers: HeadersInit = {},
): Response {
  const bounded = `${body.slice(0, 1023).replace(/[\r\n]+/g, " ").trim()}\n`;
  const bytes = new TextEncoder().encode(bounded);
  return new Response(method === "HEAD" ? null : bytes, {
    status,
    headers: {
      ...Object.fromEntries(new Headers(headers)),
      "content-type": "text/plain; charset=utf-8",
      "content-length": String(bytes.length),
    },
  });
}

function mapped(error: unknown, method: string): Response {
  if (error instanceof VerifiedAbsent) {
    return textError("not found", method, 404);
  }
  if (
    error instanceof BudgetExceeded && /deadline|timeout/i.test(error.message)
  ) return textError("upstream timeout", method, 504);
  return textError("bad gateway", method, 502);
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
  const handleRequest = async (
    request: Request,
    trace: number,
    cancellation: AbortSignal,
  ): Promise<Response> => {
    if (closed) {
      debugHttpRoute("handler closed", { requestId: trace });
      return textError("service unavailable", request.method, 503);
    }
    const pathname = new URL(request.url).pathname;
    if (
      pathname === "/health" &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      if (!dependencies.health) {
        debugHttpRoute("health route unavailable", { requestId: trace });
        return textError("not found", request.method, 404);
      }
      debugHttpRoute("serving health snapshot", { requestId: trace });
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
        debugHttpRoute("PUT rejected: write capability unavailable", {
          requestId: trace,
        });
        return textError("method not allowed", request.method, 405, {
          allow: "GET, HEAD",
        });
      }
      try {
        await readiness.authorize?.();
      } catch {
        debugHttpRoute("PUT rejected: signer authorization failed", {
          requestId: trace,
        });
        return textError("method not allowed", request.method, 405, {
          allow: "GET, HEAD",
        });
      }
      const url = new URL(request.url);
      if (
        url.search || url.hash || url.pathname.includes("%") ||
        request.body === null
      ) return textError("not found", request.method, 404);
      if (
        (request.headers.get("content-encoding") ?? "identity")
          .toLowerCase() !== "identity"
      ) return textError("unsupported content encoding", request.method, 415);
      const narinfoMatch = /^\/([0-9a-z]{32})\.narinfo$/.exec(url.pathname);
      const narMatch = /^\/(nar\/[A-Za-z0-9._+-]+)$/.exec(url.pathname);
      if (!narinfoMatch && !narMatch) {
        debugHttpRoute("PUT rejected: unsupported route", {
          requestId: trace,
          path: debugPath(url.pathname),
        });
        return textError("not found", request.method, 404);
      }
      const route = narinfoMatch ? `${narinfoMatch[1]}.narinfo` : narMatch![1];
      try {
        debugHttpRoute("staging upload", {
          requestId: trace,
          route,
          kind: narinfoMatch ? "narinfo" : "nar",
        });
        const staged = await readiness.repository.stage(
          route,
          request.body,
          cancellation,
          narinfoMatch ? dependencies.decodedMetadataBytes : undefined,
        );
        if (narinfoMatch) {
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
        debugHttpRoute("upload staged", { requestId: trace, route });
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
          return textError("immutable route conflict", request.method, 409);
        }
        if (error instanceof RangeError) {
          emitOperational({
            type: "staging_failure",
            code: "staging_too_large",
            routeClass,
            status: 413,
          });
          return textError("payload too large", request.method, 413);
        }
        if (error instanceof TypeError) {
          emitOperational({
            type: "staging_failure",
            code: "staging_invalid_narinfo",
            routeClass,
            status: 400,
          });
          return textError("invalid narinfo", request.method, 400);
        }
        emitOperational({
          type: "staging_failure",
          code: "staging_unavailable",
          routeClass,
          status: 503,
        });
        return textError("staging unavailable", request.method, 503);
      }
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return textError("method not allowed", request.method, 405, {
        allow: "GET, HEAD",
      });
    }
    if (pathname === "/nix-cache-info") return text(CACHE_INFO, request.method);
    const narinfoMatch = /^\/([0-9a-z]{32})\.narinfo$/.exec(pathname);
    const narMatch = /^\/(nar\/[A-Za-z0-9._+\/-]+)$/.exec(pathname);
    if (!narinfoMatch && !narMatch) {
      return textError("not found", request.method, 404);
    }
    if (
      snapshot.length === 0 && !overlaySnapshot?.entries.has(pathname.slice(1))
    ) {
      // Stock `nix copy --to` probes the destination before uploading. A
      // writable empty cache must report an absent route, not an unavailable
      // cache, or Nix aborts before issuing the first PUT.
      if (dependencies.write?.current().ready) {
        debugHttpRoute("empty writable cache miss", { requestId: trace });
        return textError("not found", request.method, 404);
      }
      return textError("cache unavailable", request.method, 503);
    }
    const path = narinfoMatch ? `${narinfoMatch[1]}.narinfo` : narMatch![1];
    let releaseOverlay: (() => void) | undefined;
    let servingPublication: SelectedPublication | undefined;
    let servingRoute: "pinned" | "fallback" = "fallback";
    try {
      if (narinfoMatch) {
        const signerEntry = overlaySnapshot?.entries.get(path);
        if (signerEntry && overlaySnapshot) {
          debugHttpRoute("loading Narinfo from writable overlay", {
            requestId: trace,
            path,
          });
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
          signal: cancellation,
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
        debugHttpRoute("loaded merged Narinfo", {
          requestId: trace,
          path,
          nar: debugPath(merged.record.url),
          providers: merged.providers.length,
          winner: cacheIdentity(merged.winner),
        });
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
        debugHttpRoute("serving NAR from pinned writable overlay", {
          requestId: trace,
          path,
        });
        releaseOverlay = pinnedSigner.release;
        resolved = await dependencies.overlay!.resolver(pinnedSigner.snapshot)
          .resolve(
            "",
            path,
            request.method,
          );
      } else if (overlaySnapshot?.entries.has(path)) {
        debugHttpRoute("serving NAR from current writable overlay", {
          requestId: trace,
          path,
        });
        const leased = dependencies.overlay!.acquire();
        releaseOverlay = leased.release;
        resolved = await dependencies.overlay!.resolver(leased.snapshot)
          .resolve("", path, request.method);
      }
      const pinned = routes.get(path);
      if (!resolved && pinned) {
        servingPublication = pinned;
        servingRoute = "pinned";
        resolved = await dependencies.resolverFor(pinned).resolve(
          pinned.root.hex,
          path,
          request.method,
          budget,
          cancellation,
        );
      } else if (!resolved) {
        for (const publication of snapshot) {
          try {
            servingPublication = publication;
            resolved = await dependencies.resolverFor(publication).resolve(
              publication.root.hex,
              path,
              request.method,
              budget,
              cancellation,
            );
            break;
          } catch (error) {
            if (!(error instanceof VerifiedAbsent)) throw error;
          }
        }
        if (!resolved) throw new VerifiedAbsent(path);
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
      if (narMatch && error instanceof NarResolutionFailed) {
        if (servingPublication) {
          emitOperational({
            type: "hashtree_nar",
            code: "nar_resolution_failed",
            method: request.method,
            path,
            cacheIdentity: cacheIdentity(servingPublication),
            rootHash: servingPublication.root.hex,
            eventId: servingPublication.event.id,
            route: servingRoute,
          });
        }
        debugHttpRoute("NAR source resolution failed", {
          requestId: trace,
          path,
          sources: error.sources,
        });
      }
      debugHttpRoute("request resolution failed", {
        requestId: trace,
        path,
        error: error instanceof VerifiedAbsent
          ? "not_found"
          : error instanceof BudgetExceeded
          ? "budget_exceeded"
          : "upstream_failure",
      });
      return mapped(error, request.method);
    }
  };
  const handler = async (
    request: Request,
    info?: Pick<Deno.ServeHandlerInfo, "completed">,
  ): Promise<Response> => {
    const trace = inboundRequestId();
    const started = Date.now();
    const url = new URL(request.url);
    const listener = debugEndpoint(url.origin);
    let cancellation: AbortController | undefined;
    if (info) {
      const controller = new AbortController();
      cancellation = controller;
      // ServeHandlerInfo.completed rejects when the client disconnects or the
      // response write fails. Derive request-work cancellation from that
      // mode-independent lifecycle signal instead of Deno's legacy
      // request.signal behavior.
      void info.completed.catch((error) => controller.abort(error));
    }
    let status = 500;
    let reasons: readonly string[] | undefined;
    let finalized = false;
    const finalize = () => {
      if (finalized) return;
      finalized = true;
      debugHttpRequest("completed", {
        direction: "inbound",
        inboundId: trace,
        listener,
        method: request.method,
        path: debugPath(url.pathname),
        status,
        durationMs: Math.max(0, Date.now() - started),
        ...(reasons?.length ? { reasons } : {}),
      });
    };
    try {
      debugHttpRequest("started", {
        direction: "inbound",
        inboundId: trace,
        listener,
        method: request.method,
        path: debugPath(url.pathname),
      });
      let response = await handleRequest(
        request,
        trace,
        cancellation?.signal ?? request.signal,
      );
      status = response.status;
      if (status === 503 && dependencies.health) {
        const health = dependencies.health.current();
        reasons = [
          ...health.process.reasons,
          ...health.read.reasons,
          ...health.write.reasons,
        ];
        if (reasons.length > 0) {
          response = textError(
            `cache unavailable: ${reasons.join(", ")}`,
            request.method,
            503,
            response.headers,
          );
        }
      }
      return response;
    } catch (error) {
      finalize();
      throw error;
    } finally {
      if (request.method === "GET" || request.method === "HEAD") {
        emitOperational({
          type: "http_request",
          code: "request_handled",
          method: request.method,
          path: url.pathname,
          status,
          durationMs: Math.max(0, Date.now() - started),
        });
      }
      if (info) {
        // A handler return only starts delivery for streaming responses. Deno's
        // completion promise is the lifecycle boundary for successful delivery
        // (and rejects on disconnect/write failure), independent of abort mode.
        void info.completed.then(finalize, finalize);
      } else {
        // Direct handler calls in tests and embedders have no transport phase.
        finalize();
      }
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
