import { RelayPool } from "applesauce-relay";
import { type Observable } from "rxjs";
import {
  type AppDependencies,
  type Bind,
  createApp,
  startApp,
} from "../app.ts";
import { BlobFetcher } from "../blossom/blob_fetcher.ts";
import { buildSourcePlan } from "../blossom/source_plan.ts";
import { type RawConfig, type ValidatedConfig } from "../config/config.ts";
import { PathResolver, RequestBudget } from "../hashtree/reader.ts";
import {
  AddressPolicy,
  PinnedTransport,
  SafeFetcher,
} from "../network/safe_fetcher.ts";
import {
  createNixHttpHandler,
  type SelectionView,
} from "../nix/http_handler.ts";
import { startPublicationSelection } from "../nostr/selection.ts";
import { StateRepository } from "../persistence/state_repository.ts";
import type { RawPublication } from "../protocol/publication.ts";

export interface PublicationEventStream {
  readonly events: Observable<RawPublication>;
  dispose(): void;
}

export function createPublicationEventStream(
  config: ValidatedConfig,
): PublicationEventStream {
  const pool = new RelayPool();
  const events = pool.subscription(
    config.relayUrls.map(String),
    [{ kinds: [17091, 37091, 10063], authors: [...config.publisherPubkeys] }],
  ) as Observable<RawPublication>;
  let disposed = false;
  return {
    events,
    dispose() {
      if (disposed) return;
      disposed = true;
      pool.close();
    },
  };
}

export interface ProductionHooks {
  readonly createEventStream?: (
    config: ValidatedConfig,
  ) => PublicationEventStream;
  readonly bind?: Bind;
  readonly signals?: readonly ("SIGINT" | "SIGTERM")[];
}

export function createProductionDependencies(
  hooks: ProductionHooks = {},
): AppDependencies {
  return {
    openRepository(config) {
      Deno.mkdirSync(config.spoolDirectory, { recursive: true, mode: 0o700 });
      try {
        Deno.chmodSync(config.spoolDirectory, 0o700);
      } catch { /* platform may not support chmod */ }
      return new StateRepository(config.databasePath);
    },
    createSelection(repository, config) {
      if (!(repository instanceof StateRepository)) {
        throw new TypeError("production repository has unexpected type");
      }
      const stream = (hooks.createEventStream ?? createPublicationEventStream)(
        config,
      );
      const selector = startPublicationSelection({
        events: stream.events,
        repository,
        publisherPubkeys: config.publisherPubkeys,
        identities: config.identities,
        onReject: (_event, reason) =>
          console.error(`publication rejected: ${reason}`),
        onError: (error) => console.error("publication selection error", error),
      });
      let disposed = false;
      return {
        current: () => selector.current(),
        repository,
        dispose() {
          if (disposed) return;
          disposed = true;
          try {
            selector.dispose();
          } finally {
            stream.dispose();
          }
        },
      };
    },
    createHandler(selection, config) {
      if (
        !("current" in selection) || typeof selection.current !== "function"
      ) {
        throw new TypeError("production selection has unexpected type");
      }
      const repository =
        (selection as typeof selection & { repository?: StateRepository })
          .repository;
      if (!repository) {
        throw new TypeError("production selection omitted repository");
      }
      const fetcher = new SafeFetcher(
        new AddressPolicy(undefined, config.preferredBlossomUrl?.href),
        new PinnedTransport(),
        {
          maxRedirects: config.limits.maxRedirects,
          connectTimeoutMs: config.limits.connectTimeoutMs,
          idleTimeoutMs: config.limits.idleTimeoutMs,
          totalTimeoutMs: config.limits.totalTimeoutMs,
        },
      );
      const blobs = new BlobFetcher({
        fetcher,
        quarantine: repository,
        spoolDirectory: config.spoolDirectory,
      });
      return createNixHttpHandler({
        decodedMetadataBytes: config.limits.decodedMetadataBytes,
        selection: {
          current: () =>
            (selection as unknown as {
              current(): readonly import("../nostr/selection.ts").SelectedPublication[];
            })
              .current()[0],
        } satisfies SelectionView,
        resolverFor(snapshot) {
          const sources = buildSourcePlan({
            configured: config.preferredBlossomUrl,
            event: snapshot.blossomServers,
            bud03: snapshot.bud03Servers,
            isQuarantined: (origin) => repository.isQuarantined(origin),
          });
          return new PathResolver(blobs, sources, {
            maxWireBytes: config.limits.manifestWireBytes,
            maxDecodedBytes: config.limits.totalDecodedManifestBytes,
            maxLinks: config.limits.linksPerNode,
          });
        },
        budgetFor: () =>
          new RequestBudget({
            maxDepth: config.limits.traversalDepth,
            maxLinks: config.limits.linksPerNode *
              config.limits.uniqueManifestNodes,
            maxUniqueNodes: config.limits.uniqueManifestNodes,
            maxDecodedBytes: config.limits.totalDecodedManifestBytes,
            maxAttempts: config.limits.sourceAttempts,
            maxRedirects: config.limits.maxRedirects,
            maxConcurrent: config.limits.concurrentFetches,
            maxBlobTransferBytes: config.limits.blobTransferBytes,
            maxTransferredBytes: config.limits.requestTransferBytes,
            maxOutputBytes: config.limits.requestOutputBytes,
            deadline: Date.now() + config.limits.totalTimeoutMs,
          }),
      });
    },
  };
}

export type LaunchResult =
  | { readonly ok: false; readonly diagnostics: readonly string[] }
  | {
    readonly ok: true;
    readonly shutdown: () => Promise<void>;
    readonly finished: Promise<void>;
  };

export function launchDaemon(
  raw: RawConfig,
  hooks: ProductionHooks = {},
): LaunchResult {
  const app = createApp(raw, createProductionDependencies(hooks));
  if (!app.ok) return app;
  const running = startApp(app.value, hooks.bind);
  let resolveFinished!: () => void;
  const finished = new Promise<void>((resolve) => resolveFinished = resolve);
  let stopping: Promise<void> | undefined;
  const listeners = new Map<"SIGINT" | "SIGTERM", () => void>();
  const shutdown = () =>
    stopping ??= (async () => {
      try {
        await running.shutdown();
      } finally {
        for (const [signal, listener] of listeners) {
          Deno.removeSignalListener(signal, listener);
        }
        resolveFinished();
      }
    })();
  for (const signal of hooks.signals ?? ["SIGINT", "SIGTERM"] as const) {
    const listener = () => void shutdown();
    listeners.set(signal, listener);
    Deno.addSignalListener(signal, listener);
  }
  return { ok: true, shutdown, finished };
}
