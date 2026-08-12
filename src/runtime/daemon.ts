import { RelayPool } from "applesauce-relay";
import { NostrConnectSigner } from "applesauce-signers/signers/nostr-connect-signer";
import { type Observable } from "rxjs";
import {
  type AppDependencies,
  type Bind,
  createApp,
  startApp,
} from "../app.ts";
import { BlobFetcher } from "../blossom/blob_fetcher.ts";
import { BlobCacheSink } from "../blossom/cache_sink.ts";
import { buildSourcePlan } from "../blossom/source_plan.ts";
import { type RawConfig, type ValidatedConfig } from "../config/config.ts";
import {
  PathResolver,
  RequestBudget,
  VerifiedAbsent,
} from "../hashtree/reader.ts";
import {
  AddressPolicy,
  PinnedTransport,
  SafeFetcher,
} from "../network/safe_fetcher.ts";
import {
  createNixHttpHandler,
  type SelectionView,
} from "../nix/http_handler.ts";
import { WinnerRouteRegistry } from "../nix/merged_cache.ts";
import { startPublicationSelection } from "../nostr/selection.ts";
import { StateRepository } from "../persistence/state_repository.ts";
import { WriteRepository } from "../persistence/write_repository.ts";
import { EligibilityModel } from "../write/eligibility.ts";
import { SignerOverlay } from "../write/overlay.ts";
import {
  createSignerCapability,
  type SignerCapability,
} from "../signer/capability.ts";
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
  const supervisors = new WeakMap<object, {
    readonly abort: AbortController;
    readonly tasks: Set<Promise<void>>;
  }>();
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
      const writeRepository = config.writeIntent.mode === "disabled"
        ? undefined
        : new WriteRepository(
          `${config.databasePath}.writes`,
          config.stagingDirectory!,
          {
            perBodyBytes: config.stagingBodyBytes,
            aggregateBytes: config.stagingAggregateBytes,
          },
        );
      let signer: SignerCapability | undefined;
      if (config.writeIntent.mode !== "disabled") {
        signer = createSignerCapability({
          intent: config.writeIntent,
          localKeyPath: config.localKeyPath,
          nip46SessionPath: config.nip46SessionPath,
          createNip46Signer: async (session, permissionKind) => {
            const pool = new RelayPool();
            const remote = await NostrConnectSigner.fromNbunksec(session, {
              permissions: NostrConnectSigner.buildSigningPermissions([
                permissionKind,
              ]),
              subscriptionMethod: (relays, filters) =>
                pool.subscription(relays, filters),
              publishMethod: (relays, event) => pool.publish(relays, event),
              onAuth: () => {
                console.warn("nip46 authorization required");
                return Promise.resolve();
              },
            });
            return {
              getPublicKey: () => remote.getPublicKey(),
              async close() {
                try {
                  await remote.close();
                } finally {
                  pool.close();
                }
              },
            };
          },
        });
        void signer.start();
      }
      let disposed = false;
      const selectionHandle = {
        current: () => selector.current(),
        repository,
        writeRepository,
        signer,
        async dispose() {
          if (disposed) return;
          disposed = true;
          const supervisor = supervisors.get(selectionHandle);
          supervisor?.abort.abort("daemon shutdown");
          const finish = async () => {
            try {
              selector.dispose();
            } finally {
              stream.dispose();
              try {
                await signer?.close();
              } finally {
                writeRepository?.close();
              }
            }
          };
          if (supervisor?.tasks.size) {
            await Promise.allSettled(supervisor.tasks);
          }
          await finish();
        },
      };
      return selectionHandle;
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
      const writeRepository =
        (selection as typeof selection & { writeRepository?: WriteRepository })
          .writeRepository;
      const signer =
        (selection as typeof selection & { signer?: SignerCapability }).signer;
      const fetcher = new SafeFetcher(
        new AddressPolicy(
          undefined,
          [config.localBlossomUrl, config.preferredBlossomUrl]
            .filter((url): url is URL => url !== undefined)
            .map((url) => url.href),
        ),
        new PinnedTransport(),
        {
          maxRedirects: config.limits.maxRedirects,
          connectTimeoutMs: config.limits.connectTimeoutMs,
          idleTimeoutMs: config.limits.idleTimeoutMs,
          totalTimeoutMs: config.limits.totalTimeoutMs,
        },
      );
      const supervisor = {
        abort: new AbortController(),
        tasks: new Set<Promise<void>>(),
      };
      supervisors.set(selection as object, supervisor);
      const cacheSink = config.localBlossomUrl
        ? new BlobCacheSink({
          request: fetcher.request.bind(fetcher),
          localOrigin: config.localBlossomUrl,
          maxDescriptorBytes: config.limits.decodedMetadataBytes,
        })
        : undefined;
      const blobs = new BlobFetcher({
        fetcher,
        quarantine: repository,
        spoolDirectory: config.spoolDirectory,
        onLocalDiagnostic: (diagnostic) =>
          console.warn("local cache diagnostic", diagnostic),
        onVerifiedRemote: cacheSink
          ? (blob) => {
            const task = cacheSink.populate(blob, supervisor.abort.signal)
              .then((result) => {
                if (!result.ok) {
                  console.warn("local cache diagnostic", result.diagnostic);
                }
              })
              .finally(() => supervisor.tasks.delete(task));
            supervisor.tasks.add(task);
          }
          : undefined,
      });
      const budgetFor = () =>
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
        });
      const publisherResolver = (
        snapshot: import("../nostr/selection.ts").SelectedPublication,
      ) => {
        const sources = buildSourcePlan({
          localCache: config.localBlossomUrl,
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
      };
      const overlay = writeRepository
        ? new SignerOverlay(writeRepository)
        : undefined;
      const eligibility = writeRepository && overlay
        ? new EligibilityModel(writeRepository, overlay, {
          maxVisited: config.limits.uniqueManifestNodes,
          maxMetadataBytes: config.limits.totalDecodedManifestBytes,
          lowerHasStorePath: async (hash) => {
            const publishers = (selection as unknown as {
              current(): readonly import("../nostr/selection.ts").SelectedPublication[];
            }).current();
            for (const publication of publishers) {
              try {
                await publisherResolver(publication).resolve(
                  publication.root.hex,
                  `${hash}.narinfo`,
                  "HEAD",
                  budgetFor(),
                  supervisor.abort.signal,
                );
                return true;
              } catch (error) {
                if (!(error instanceof VerifiedAbsent)) throw error;
              }
            }
            return false;
          },
        })
        : undefined;
      return createNixHttpHandler({
        decodedMetadataBytes: config.limits.decodedMetadataBytes,
        selection: {
          current: () =>
            (selection as unknown as {
              current(): readonly import("../nostr/selection.ts").SelectedPublication[];
            })
              .current(),
        } satisfies SelectionView,
        routes: new WinnerRouteRegistry(4096, 5 * 60_000),
        overlay,
        diagnostics: {
          emit: (diagnostic) =>
            console.warn("merged cache diagnostic", diagnostic),
        },
        write: signer && writeRepository
          ? {
            current: () => {
              const state = signer.current();
              const selected = (selection as unknown as {
                current(): readonly import("../nostr/selection.ts").SelectedPublication[];
              }).current();
              const hasDestination = config.localBlossomUrl !== undefined ||
                config.preferredBlossomUrl !== undefined ||
                selected.some((item) => item.bud03Servers.length > 0);
              return {
                ready: state.status === "ready" && writeRepository.health() &&
                  config.relayUrls.length > 0 && hasDestination,
                repository: writeRepository,
                onStaged: (route) =>
                  eligibility?.changed(route) ?? Promise.resolve(false),
              };
            },
          }
          : undefined,
        resolverFor(snapshot) {
          return publisherResolver(snapshot);
        },
        budgetFor,
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
