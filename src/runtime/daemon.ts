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
import { PublicationUploader } from "../blossom/publication_uploader.ts";
import { buildSourcePlan } from "../blossom/source_plan.ts";
import { type RawConfig, type ValidatedConfig } from "../config/config.ts";
import {
  PathResolver,
  RequestBudget,
  VerifiedAbsent,
} from "../hashtree/reader.ts";
import { HashtreeWriter } from "../hashtree/writer.ts";
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
import { LocalRelayCache } from "../nostr/local_relay_cache.ts";
import { StateRepository } from "../persistence/state_repository.ts";
import { WriteRepository } from "../persistence/write_repository.ts";
import { EligibilityModel } from "../write/eligibility.ts";
import { SignerOverlay } from "../write/overlay.ts";
import { PublicationBatchScheduler } from "../write/batch_scheduler.ts";
import { PublicationCoordinator } from "../write/publication_coordinator.ts";
import {
  createSignerCapability,
  type SignerCapability,
} from "../signer/capability.ts";
import type { RawPublication } from "../protocol/publication.ts";
import {
  createJsonDiagnosticSink,
  type OperationalDiagnosticSink,
} from "../operations/diagnostics.ts";
import { createHealthSnapshotProvider } from "../operations/health.ts";
import {
  createPasswordRequest,
  type PasswordRequest,
} from "./password_prompt.ts";

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
  readonly diagnostics?: OperationalDiagnosticSink;
  readonly requestPassword?: PasswordRequest;
}

export function createProductionDependencies(
  hooks: ProductionHooks = {},
): AppDependencies {
  const diagnostics = hooks.diagnostics ?? createJsonDiagnosticSink();
  const supervisors = new WeakMap<object, {
    readonly abort: AbortController;
    readonly tasks: Set<Promise<void>>;
    readonly drains: Set<() => Promise<void>>;
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
      const writable = config.writable.enabled ? config.writable : undefined;
      const localRelayPool = writable?.publication.localRelayUrl
        ? new RelayPool()
        : undefined;
      const localRelay = writable?.publication.localRelayUrl && localRelayPool
        ? new LocalRelayCache(
          writable.publication.localRelayUrl,
          async (relay, event) => {
            try {
              return (await localRelayPool.publish([relay], event)).some((
                outcome,
              ) => outcome.ok);
            } catch {
              return false;
            }
          },
        )
        : undefined;
      const selector = startPublicationSelection({
        events: stream.events,
        repository,
        publisherPubkeys: config.publisherPubkeys,
        identities: config.identities,
        onReject: (event, reason) =>
          diagnostics.emit({
            type: "event_rejection",
            code: reason,
            eventId: typeof event.id === "string" ? event.id : undefined,
          }),
        onError: () =>
          diagnostics.emit({
            type: "upstream_failure",
            code: "selection_stream_failed",
          }),
        onAdmit: localRelay
          ? (event) => void localRelay.acceptObserved(event)
          : undefined,
      });
      const writeRepository = config.writeIntent.mode === "disabled"
        ? undefined
        : new WriteRepository(
          `${config.databasePath}.writes`,
          writable!.staging.directory,
          {
            perBodyBytes: writable!.staging.bodyBytes,
            aggregateBytes: writable!.staging.aggregateBytes,
          },
        );
      let signer: SignerCapability | undefined;
      let signerReady:
        | Promise<{ readonly ok: boolean; readonly pubkey?: string }>
        | undefined;
      if (config.writeIntent.mode !== "disabled") {
        const signerIdentity = config.writeIntent.identity;
        signer = createSignerCapability({
          intent: config.writeIntent,
          requestPassword: hooks.requestPassword ?? createPasswordRequest(),
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
              signEvent: (template) => remote.signEvent(template),
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
        signerReady = signer.start().then(async () => {
          const state = signer!.current();
          if (state.status !== "ready") return { ok: false } as const;
          const pubkey = await signer!.assertIdentity();
          writeRepository!.bindIdentity(
            `${signerIdentity.kind}:${pubkey}:${signerIdentity.identifier}`,
          );
          return { ok: true, pubkey } as const;
        }).catch(async () => {
          await signer!.close();
          return { ok: false } as const;
        });
        let previous = "disconnected";
        const subscription = signer.state.subscribe((state) => {
          if (state.status === previous) return;
          previous = state.status;
          diagnostics.emit({
            type: "signer_transition",
            code: state.status === "failed"
              ? `signer_${state.code}`
              : `signer_${state.status}`,
            status: state.status,
            cacheIdentity:
              `${signerIdentity.kind}:signer-derived:${signerIdentity.identifier}`,
          });
        });
        // Signer state is process-local and the subscription is closed with it.
        void signerReady.finally(() => {
          if (disposed) subscription.unsubscribe();
        });
      }
      let disposed = false;
      const selectionHandle = {
        current: () => selector.current(),
        repository,
        writeRepository,
        signer,
        signerReady,
        localRelay,
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
              localRelayPool?.close();
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
          if (supervisor?.drains.size) {
            await Promise.allSettled(
              [...supervisor.drains].map((drain) => drain()),
            );
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
      const localRelay =
        (selection as typeof selection & { localRelay?: LocalRelayCache })
          .localRelay;
      const signerReady = (selection as typeof selection & {
        signerReady?: Promise<
          { readonly ok: boolean; readonly pubkey?: string }
        >;
      })
        .signerReady;
      const writable = config.writable.enabled ? config.writable : undefined;
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
        drains: new Set<() => Promise<void>>(),
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
        onLocalDiagnostic: (item) =>
          diagnostics.emit({
            type: "upstream_failure",
            code: item.code,
            endpoint: item.origin,
          }),
        onVerifiedRemote: cacheSink
          ? (blob) => {
            const task = cacheSink.populate(blob, supervisor.abort.signal)
              .then((result) => {
                if (!result.ok) {
                  diagnostics.emit({
                    type: "upstream_failure",
                    code: result.diagnostic.code,
                    endpoint: result.diagnostic.origin,
                  });
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
      let activatedOverlay: SignerOverlay | undefined;
      let writesActivated = false;
      const overlay = writeRepository
        ? {
          current: () => activatedOverlay?.current(),
          acquire: (generation?: number) =>
            activatedOverlay!.acquire(generation),
          resolver: (
            snapshot: import("../write/overlay.ts").SignerOverlaySnapshot,
          ) => activatedOverlay!.resolver(snapshot),
        }
        : undefined;
      let eligibility: EligibilityModel | undefined;
      const activateWrites = async (pubkey: string) => {
        if (
          !writeRepository || !writable ||
          config.writeIntent.mode === "disabled"
        ) return;
        await signer!.assertIdentity();
        const nextOverlay = new SignerOverlay(writeRepository);
        const nextEligibility = new EligibilityModel(
          writeRepository,
          nextOverlay,
          {
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
          },
        );
        const nextBatchScheduler = new PublicationBatchScheduler(
          writeRepository,
          new HashtreeWriter(`${writable!.staging.directory}/candidate-blobs`, {
            maxLinks: config.limits.linksPerNode,
            maxInventoryBlobs: config.limits.uniqueManifestNodes +
              config.limits.linksPerNode,
            maxInventoryBytes: writable!.staging.aggregateBytes,
          }, writeRepository),
          undefined,
          diagnostics,
        );
        let lastDirtiedGeneration = writeRepository.activePublicationWindow()
          ?.generation ?? 0;
        const onCommitted = (generation: number) => {
          if (generation <= lastDirtiedGeneration) return;
          lastDirtiedGeneration = generation;
          nextBatchScheduler.dirty(generation);
        };
        const writableIdentity = Object.freeze({
          ...config.writeIntent.identity,
          pubkey,
        });
        const publishPool = new RelayPool();
        const uploader = new PublicationUploader({
          request: fetcher.request.bind(fetcher),
        });
        const coordinator = new PublicationCoordinator({
          repository: writeRepository,
          signer: signer!,
          selector:
            selection as unknown as import("../nostr/selection.ts").PublicationSelector,
          identity: writableIdentity,
          authorize: () => signer!.assertIdentity().then(() => {}),
          blossomServers: () => {
            if (signer!.current().status !== "ready") return Object.freeze([]);
            const owned = (selection as unknown as {
              current(): readonly import("../nostr/selection.ts").SelectedPublication[];
            }).current().find((item) =>
              item.event.pubkey === writableIdentity.pubkey
            );
            return Object.freeze([
              ...new Set([
                ...(config.preferredBlossomUrl
                  ? [config.preferredBlossomUrl.origin]
                  : []),
                ...(config.localBlossomUrl
                  ? [config.localBlossomUrl.origin]
                  : []),
                ...(owned?.bud03Servers ?? []),
              ]),
            ]);
          },
          nixSigKeys: writable!.publication.nixSigKeys,
          publicationRelays: config.relayUrls.map(String),
          lifetimeSeconds: writable!.publication.lifetimeSeconds,
          now: () => Math.floor(Date.now() / 1000),
          replica: {
            prove: async (server, entry, signal) => {
              await signer!.assertIdentity();
              return await uploader.prove(server, entry, signal);
            },
          },
          publishRelays: async (event, relays, signal) => {
            const abort = <T>(promise: Promise<T>): Promise<T> => {
              signal?.throwIfAborted();
              if (!signal) return promise;
              return Promise.race([
                promise,
                new Promise<never>((_, reject) =>
                  signal.addEventListener(
                    "abort",
                    () => reject(signal.reason),
                    { once: true },
                  )
                ),
              ]);
            };
            await signer!.assertIdentity();
            const outcomes = await Promise.all(relays.map(async (relay) => {
              if (localRelay?.relay === new URL(relay).href) {
                return {
                  relay,
                  ok: await abort(localRelay.publishSigned(event)),
                };
              }
              try {
                const response = await abort(
                  publishPool.publish([relay], event),
                );
                return { relay, ok: response.some((item) => item.ok) };
              } catch {
                return { relay, ok: false };
              }
            }));
            // The local relay observes only selector-admitted events. Forwarding
            // here would put an auxiliary cache behind the configured relay-OK
            // publication barrier and can strand an otherwise committed saga.
            return outcomes;
          },
          retry: {
            baseSeconds: 30,
            maxSeconds: 3600,
            maxAttempts: writable!.publication.maxAttempts,
            concurrency: writable!.publication.concurrency,
            jitter: (_kind, target) => {
              let value = 0;
              for (const byte of new TextEncoder().encode(target)) {
                value = (value * 33 + byte) >>> 0;
              }
              return value % 11;
            },
          },
          diagnostics,
        });
        let subscription: { unsubscribe(): void } | undefined;
        try {
          await nextEligibility.reconcile(onCommitted);
          await signer!.assertIdentity();
          subscription = nextEligibility.start(onCommitted);
          coordinator.start();
          activatedOverlay = nextOverlay;
          eligibility = nextEligibility;
          writesActivated = true;
          supervisor.drains.add(() => nextBatchScheduler.close());
          supervisor.drains.add(() => {
            subscription!.unsubscribe();
            return Promise.resolve();
          });
          supervisor.drains.add(async () => {
            await coordinator.close();
            publishPool.close();
          });
        } catch (error) {
          try {
            subscription?.unsubscribe();
          } catch { /* cleanup continues below */ }
          try {
            publishPool.close();
          } catch { /* cleanup continues below */ }
          await Promise.allSettled([
            coordinator.close(),
            nextBatchScheduler.close(),
          ]);
          throw error;
        }
      };
      const activationTask =
        (signerReady ?? Promise.resolve({ ok: false } as const))
          .then(async (result) => {
            if (!result.ok || !result.pubkey) return;
            await activateWrites(result.pubkey);
          }).catch(() => {})
          .finally(() => supervisor.tasks.delete(activationTask));
      supervisor.tasks.add(activationTask);
      const nixHandler = createNixHttpHandler({
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
          emit: (item) =>
            diagnostics.emit({
              type: "merge_conflict",
              code: "narinfo_semantic_conflict",
              storePathHash: item.storePathHash,
              winnerIdentity: item.winnerIdentity,
              loserIdentity: item.loserIdentity,
              differingFields: item.differingFields,
            }),
        },
        operationalDiagnostics: diagnostics,
        health: createHealthSnapshotProvider(() => {
          const selected = (selection as unknown as SelectionView).current();
          const signerState = signer?.current();
          const saga = writesActivated
            ? writeRepository?.publicationSaga()
            : undefined;
          const endpointWork = writesActivated
            ? writeRepository?.endpointWork() ?? []
            : [];
          const repairing = Boolean(
            saga?.committed &&
              endpointWork.some((item) => item.status !== "complete"),
          );
          const publication = !saga
            ? { phase: "idle" as const, completeReplica: true }
            : repairing
            ? {
              phase: "repairing" as const,
              completeReplica: Boolean(saga.completeServer),
            }
            : !saga.completeServer
            ? { phase: "replicating" as const, completeReplica: false }
            : !saga.acknowledgedRelay
            ? { phase: "awaiting_relay" as const, completeReplica: true }
            : { phase: "idle" as const, completeReplica: true };
          const destinations = new Set([
            ...(config.preferredBlossomUrl
              ? [config.preferredBlossomUrl.origin]
              : []),
            ...(config.localBlossomUrl ? [config.localBlossomUrl.origin] : []),
            ...selected.flatMap((item) => item.bud03Servers),
          ]).size;
          return {
            process: { repositoryHealthy: writeRepository?.health() ?? true },
            read: {
              selectedPublications: selected.length,
              overlayEntries: overlay?.current()?.entries.size ?? 0,
            },
            write: config.writeIntent.mode === "disabled"
              ? { enabled: false }
              : {
                enabled: true,
                repositoryHealthy: writeRepository?.health() ?? false,
                signerStatus: signerState?.status ?? "disconnected",
                signerOwned: signerState?.status === "ready" ||
                  (signerState?.status === "failed" &&
                    signerState.code !== "identity_changed"),
                destinations,
                relays: config.relayUrls.length,
                publication,
              },
          };
        }),
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
                  writesActivated &&
                  config.writeIntent.mode !== "disabled" &&
                  writeRepository.boundIdentity() ===
                    `${config.writeIntent.identity.kind}:${state.pubkey}:${config.writeIntent.identity.identifier}` &&
                  config.relayUrls.length > 0 && hasDestination,
                repository: writeRepository,
                authorize: () => signer.assertIdentity().then(() => {}),
                onStaged: async (route) => {
                  await signer.assertIdentity();
                  return await (eligibility?.changed(route) ?? false);
                },
              };
            },
          }
          : undefined,
        resolverFor(snapshot) {
          return publisherResolver(snapshot);
        },
        budgetFor,
      });
      supervisor.drains.add(() => {
        nixHandler.close();
        return Promise.resolve();
      });
      return nixHandler;
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
