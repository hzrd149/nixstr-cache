import { NostrConnectSigner } from "applesauce-signers/signers/nostr-connect-signer";
import { blossomServers } from "applesauce-common/helpers";
import {
  type AppDependencies,
  type Bind,
  createApp,
  startApp,
} from "../app.ts";
import { BlobFetcher } from "../blossom/blob_fetcher.ts";
import { BlobStore } from "../persistence/blob_store.ts";
import { PublicationUploader } from "../blossom/publication_uploader.ts";
import {
  createUploadAuthorizationBatch,
  type UploadAuthorizationBatch,
} from "../blossom/upload_authorization.ts";
import { buildSourcePlan } from "../blossom/source_plan.ts";
import { type RawConfig, type ValidatedConfig } from "../config/config.ts";
import {
  PathResolver,
  RequestBudget,
  VerifiedAbsent,
} from "../hashtree/reader.ts";
import { HashtreeWriter } from "../hashtree/writer.ts";
import { VerifiedManifestCache } from "../hashtree/manifest_cache.ts";
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
import {
  createPublicationEventStream,
  type PublicationEventStream,
} from "../nostr/publications.ts";
import {
  closeNostr,
  createNostrService,
  initializeNostr,
  type NostrService,
} from "../nostr/runtime.ts";
import { StateRepository } from "../persistence/state_repository.ts";
import {
  WriteIdentityMismatch,
  WriteRepository,
} from "../persistence/write_repository.ts";
import { EligibilityModel } from "../write/eligibility.ts";
import { SignerOverlay } from "../write/overlay.ts";
import { PublicationBatchScheduler } from "../write/batch_scheduler.ts";
import { PublicationCoordinator } from "../write/publication_coordinator.ts";
import {
  createSignerCapability,
  type SignerCapability,
} from "../signer/capability.ts";
import type { RawPublication } from "../protocol/publication.ts";
import { cacheIdentity } from "../protocol/publication.ts";
import {
  createConsoleDiagnosticSink,
  type OperationalDiagnosticSink,
} from "../operations/diagnostics.ts";
import { debugCacheState } from "../operations/debug.ts";
import { createHealthSnapshotProvider } from "../operations/health.ts";
import {
  createPasswordRequest,
  type PasswordRequest,
} from "./password_prompt.ts";

interface WriteBlossomDestination {
  readonly url: string;
  readonly trust: "configured" | "publisher";
}

function writeBlossomDestinations(
  bud03: readonly string[],
): readonly WriteBlossomDestination[] {
  const ordered: Array<[string | URL, WriteBlossomDestination["trust"]]> = [];
  for (const server of bud03) ordered.push([server, "publisher"]);
  const seen = new Set<string>();
  return Object.freeze(ordered.flatMap(([value, trust]) => {
    try {
      const url = new URL(value);
      if (
        !["http:", "https:"].includes(url.protocol) || url.username ||
        url.password || url.search || url.hash
      ) return [];
      url.pathname = url.pathname.replace(/\/+$/, "");
      const normalized = url.href.replace(/\/$/, "");
      if (seen.has(normalized)) return [];
      seen.add(normalized);
      return [Object.freeze({ url: normalized, trust })];
    } catch {
      return [];
    }
  }));
}

export interface ProductionHooks {
  readonly createEventStream?: (
    config: ValidatedConfig,
    service: NostrService,
  ) => PublicationEventStream;
  readonly bind?: Bind;
  readonly signals?: readonly ("SIGINT" | "SIGTERM")[];
  readonly diagnostics?: OperationalDiagnosticSink;
  readonly requestPassword?: PasswordRequest;
}

export function createProductionDependencies(
  hooks: ProductionHooks = {},
): AppDependencies {
  const diagnostics = hooks.diagnostics ?? createConsoleDiagnosticSink();
  const supervisors = new WeakMap<object, {
    readonly abort: AbortController;
    readonly tasks: Set<Promise<void>>;
    readonly drains: Set<() => Promise<void>>;
  }>();
  const nostrServices = new WeakMap<object, NostrService>();
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
      const sharedNostr = hooks.createEventStream === undefined;
      const nostr = sharedNostr
        ? initializeNostr(config)
        : createNostrService(config);
      const stream = (hooks.createEventStream ?? createPublicationEventStream)(
        config,
        nostr,
      );
      const writable = config.writable.enabled ? config.writable : undefined;
      const localRelay = writable?.publication.localRelayUrl
        ? new LocalRelayCache(
          writable.publication.localRelayUrl,
          async (relay, event) => {
            try {
              return (await nostr.pool.publish([relay], event)).some((
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
        eventStore: nostr.store,
        addAcceptedPublication: nostr.addAcceptedPublication,
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
      let cacheSelectionSeen = false;
      let selectedRoots = new Map<string, string>();
      const cacheSelectionSubscription = selector.selected$.subscribe(
        (selected) => {
          const nextRoots = new Map(
            selected.map((publication) => [
              cacheIdentity(publication),
              publication.root.nhash,
            ]),
          );
          const htreeLinks = selected.flatMap((publication) =>
            selectedRoots.get(cacheIdentity(publication)) ===
                publication.root.nhash
              ? []
              : [`htree://${publication.root.nhash}`]
          );
          selectedRoots = nextRoots;
          try {
            debugCacheState("selected", {
              count: selected.length,
              caches: selected.map((publication) =>
                `${cacheIdentity(publication)}@${publication.root.nhash}`
              ),
            });
          } catch { /* debug logging is non-authoritative */ }
          diagnostics.emit({
            type: "cache_selection",
            code: cacheSelectionSeen
              ? "cache_selection_changed"
              : "cache_selection_found",
            count: selected.length,
            caches: selected.map(cacheIdentity),
            htreeLinks,
          });
          cacheSelectionSeen = true;
        },
      );
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
      const blobStore = writeRepository
        ? writeRepository.openBlobStore(`${config.databasePath}.blobs`)
        : new BlobStore(
          `${config.databasePath}.writes`,
          `${config.databasePath}.blobs`,
        );
      const storeReady = blobStore.migrateLegacy({
        spoolDirectory: config.spoolDirectory,
        ...(writable ? { stagingDirectory: writable.staging.directory } : {}),
      });
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
            const remote = await NostrConnectSigner.fromNbunksec(session, {
              permissions: NostrConnectSigner.buildSigningPermissions([
                permissionKind,
                24242,
              ]),
              subscriptionMethod: (relays, filters) =>
                nostr.pool.subscription(relays, filters),
              publishMethod: (relays, event) =>
                nostr.pool.publish(relays, event),
              onAuth: () => {
                console.warn("nip46 authorization required");
                return Promise.resolve();
              },
            });
            return {
              getPublicKey: () => remote.getPublicKey(),
              signEvent: (template) => remote.signEvent(template),
              close: () => remote.close(),
            };
          },
        });
        signerReady = storeReady.then(() => signer!.start()).then(async () => {
          const state = signer!.current();
          if (state.status !== "ready") return { ok: false } as const;
          const pubkey = await signer!.assertIdentity();
          writeRepository!.bindIdentity(
            `${signerIdentity.kind}:${pubkey}:${signerIdentity.identifier}`,
          );
          return { ok: true, pubkey } as const;
        }).catch(async (error) => {
          if (error instanceof WriteIdentityMismatch) {
            const state = signer!.current();
            const durableIdentity = writeRepository!.boundIdentity();
            if (state.status === "ready" && durableIdentity) {
              diagnostics.emit({
                type: "writable_identity_mismatch",
                code: "durable_writable_identity_mismatch",
                configuredIdentity:
                  `${signerIdentity.kind}:${state.pubkey}:${signerIdentity.identifier}`,
                durableIdentity,
              });
            }
          }
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
        selected$: selector.selected$,
        accept: (event: RawPublication) => selector.accept(event),
        authorizeBlossomPublisher: (pubkey: string) =>
          selector.authorizeBlossomPublisher(pubkey),
        authorizePublicationPublisher: (pubkey: string, identity: string) =>
          selector.authorizePublicationPublisher(pubkey, identity),
        blossomServersFor: (pubkey: string) =>
          selector.blossomServersFor(pubkey),
        watchBlossomServers: (pubkey: string, callback: () => void) =>
          selector.watchBlossomServers(pubkey, callback),
        repository,
        writeRepository,
        blobStore,
        storeReady,
        signer,
        signerReady,
        followBlossomPublisher: stream.followBlossomPublisher,
        localRelay,
        async readyBeforeBind() {
          await storeReady;
          if (config.writeIntent.mode !== "ncryptsec") return;
          const result = await signerReady;
          if (!result?.ok || !result.pubkey) {
            throw new Error("ncryptsec signer could not be unlocked");
          }
        },
        async dispose() {
          if (disposed) return;
          disposed = true;
          const supervisor = supervisors.get(selectionHandle);
          supervisor?.abort.abort("daemon shutdown");
          const finish = async () => {
            const errors: unknown[] = [];
            try {
              cacheSelectionSubscription.unsubscribe();
              selector.dispose();
            } catch (error) {
              errors.push(error);
            }
            try {
              stream.close();
            } catch (error) {
              errors.push(error);
            }
            try {
              await signer?.close();
            } catch (error) {
              errors.push(error);
            }
            try {
              writeRepository?.close();
              if (!writeRepository) blobStore.close();
            } catch (error) {
              errors.push(error);
            }
            try {
              if (sharedNostr) closeNostr();
              else nostr.close();
            } catch (error) {
              errors.push(error);
            }
            if (errors.length) {
              throw new AggregateError(
                errors,
                "daemon resource shutdown failed",
              );
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
      nostrServices.set(selectionHandle, nostr);
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
      const nostr = nostrServices.get(selection as object);
      if (!nostr) {
        throw new TypeError("production selection omitted Nostr runtime");
      }
      const signerReady = (selection as typeof selection & {
        signerReady?: Promise<
          { readonly ok: boolean; readonly pubkey?: string }
        >;
      })
        .signerReady;
      const followBlossomPublisher = (selection as typeof selection & {
        followBlossomPublisher?: (pubkey: string) => void;
      }).followBlossomPublisher;
      const writable = config.writable.enabled ? config.writable : undefined;
      const configuredBlossomOrigins = blossomServers(
        [],
        [...config.extraServers],
      ).map(String);
      const fetcher = new SafeFetcher(
        new AddressPolicy(
          undefined,
          configuredBlossomOrigins,
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
      const blobStore =
        (selection as typeof selection & { blobStore: BlobStore })
          .blobStore;
      const manifestCache = new VerifiedManifestCache(
        config.limits.manifestCacheEntries,
        config.limits.manifestCacheBytes,
      );
      supervisor.drains.add(() => manifestCache.close());
      const blobs = new BlobFetcher({
        fetcher,
        quarantine: repository,
        store: blobStore,
        onLocalDiagnostic: (item) =>
          diagnostics.emit({
            type: "upstream_failure",
            code: item.code,
            endpoint: item.origin,
          }),
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
          event: snapshot.blossomServers,
          bud03: snapshot.bud03Servers,
          extras: config.extraServers,
          isQuarantined: (origin) => repository.isQuarantined(origin),
        });
        return new PathResolver(blobs, sources, {
          maxWireBytes: config.limits.manifestWireBytes,
          maxDecodedBytes: config.limits.totalDecodedManifestBytes,
          maxLinks: config.limits.linksPerNode,
        }, manifestCache);
      };
      let activatedOverlay: SignerOverlay | undefined;
      let writesActivated = false;
      let writeActivationStatus: "initializing" | "ready" | "failed" =
        "initializing";
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
      let writeDestinations = writeBlossomDestinations([]);
      let writeRelays: readonly string[] = Object.freeze(
        config.extraRelays.map(String),
      );
      let previousWriteDestinations = "";
      const refreshWriteBlossomServers = (pubkey: string) => {
        const next =
          (selection as unknown as import("../nostr/selection.ts").PublicationSelector)
            .blossomServersFor(pubkey);
        const destinations = writeBlossomDestinations(next);
        const encoded = JSON.stringify(destinations);
        if (encoded !== previousWriteDestinations) {
          previousWriteDestinations = encoded;
          writeDestinations = destinations;
          diagnostics.emit({
            type: "blossom_server_list",
            code: "write_server_list_changed",
            count: destinations.length,
            endpoints: destinations.map((item) => item.url),
          });
        }
      };
      const activateWrites = async (pubkey: string) => {
        if (
          !writeRepository || !writable ||
          config.writeIntent.mode === "disabled"
        ) return;
        await signer!.assertIdentity();
        const publicationSelector =
          selection as unknown as import("../nostr/selection.ts").PublicationSelector;
        publicationSelector.authorizePublicationPublisher(
          pubkey,
          `${config.writeIntent.identity.kind}:${pubkey}:${config.writeIntent.identity.identifier}`,
        );
        publicationSelector.authorizeBlossomPublisher(pubkey);
        followBlossomPublisher?.(pubkey);
        nostr.followUserMetadata([pubkey]);
        const configuredWriteRelays = new Set(config.extraRelays.map(String));
        let writeRelayListSeen = false;
        const writeRelaySubscription = nostr.relaySetFor([pubkey]).subscribe(
          (relays) => {
            writeRelays = Object.freeze([...relays]);
            const configuredCount =
              relays.filter((relay) => configuredWriteRelays.has(relay)).length;
            diagnostics.emit({
              type: "write_relay_list",
              code: writeRelayListSeen
                ? "write_relay_list_changed"
                : "write_relay_list_found",
              count: relays.length,
              configuredCount,
              outboxCount: relays.length - configuredCount,
              endpoints: relays,
            });
            writeRelayListSeen = true;
          },
        );
        refreshWriteBlossomServers(pubkey);
        const stopWatchingServers = publicationSelector.watchBlossomServers(
          pubkey,
          () => refreshWriteBlossomServers(pubkey),
        );
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
          new HashtreeWriter(
            `${writable!.staging.directory}/writer-work`,
            {
              maxLinks: config.limits.linksPerNode,
              maxInventoryBlobs: config.limits.uniqueManifestNodes +
                config.limits.linksPerNode,
              maxInventoryBytes: writable!.staging.aggregateBytes,
            },
            writeRepository,
            blobStore,
          ),
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
        let uploadAuthorization:
          | (UploadAuthorizationBatch & { readonly key: string })
          | undefined;
        let pendingUploadAuthorization:
          | {
            readonly key: string;
            readonly promise: Promise<UploadAuthorizationBatch>;
          }
          | undefined;
        const prepareUploadAuthorization = async (
          servers: readonly string[],
          entries:
            readonly import("../persistence/write_repository.ts").PendingInventoryEntry[],
          signal?: AbortSignal,
        ) => {
          const hashes = entries.map((entry) => entry.hash);
          const key = JSON.stringify([servers, hashes]);
          const now = Math.floor(Date.now() / 1000);
          if (
            uploadAuthorization?.key === key &&
            uploadAuthorization.expiration > now + 30
          ) return;
          if (pendingUploadAuthorization?.key !== key) {
            const promise = createUploadAuthorizationBatch({
              signer: signer!,
              hashes,
              servers,
              now,
              signal,
            });
            pendingUploadAuthorization = { key, promise };
          }
          const prepared = pendingUploadAuthorization;
          try {
            uploadAuthorization = Object.freeze({
              ...await prepared.promise,
              key,
            });
          } finally {
            if (pendingUploadAuthorization === prepared) {
              pendingUploadAuthorization = undefined;
            }
          }
        };
        const uploader = new PublicationUploader({
          request: fetcher.request.bind(fetcher),
          authorization: (server, entry, signal) => {
            signal?.throwIfAborted();
            const header = uploadAuthorization?.header(server, entry.hash);
            if (!header) {
              throw new Error("Blossom upload authorization was not prepared");
            }
            return Promise.resolve(header);
          },
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
            return Object.freeze(writeDestinations.map((item) => item.url));
          },
          nixSigKeys: writable!.publication.nixSigKeys,
          publicationRelays: () => writeRelays,
          lifetimeSeconds: writable!.publication.lifetimeSeconds,
          now: () => Math.floor(Date.now() / 1000),
          replica: {
            prove: async (server, entry, signal) => {
              await signer!.assertIdentity();
              const destination = writeDestinations.find((item) =>
                item.url === server
              );
              return await uploader.prove(
                server,
                entry,
                signal,
                destination?.trust ?? "publisher",
              );
            },
          },
          prepareReplicaAuthorization: prepareUploadAuthorization,
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
                  nostr.pool.publish([relay], event),
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
            writeRelaySubscription.unsubscribe();
            stopWatchingServers();
            return Promise.resolve();
          });
          supervisor.drains.add(async () => {
            await coordinator.close();
          });
        } catch (error) {
          try {
            subscription?.unsubscribe();
            writeRelaySubscription.unsubscribe();
            stopWatchingServers();
          } catch { /* cleanup continues below */ }
          await Promise.allSettled([
            coordinator.close(),
            nextBatchScheduler.close(),
          ]);
          throw error;
        }
      };
      const activationTask = signerReady
        ? signerReady
          .then(async (result) => {
            if (!result.ok || !result.pubkey) {
              writeActivationStatus = "failed";
              diagnostics.emit({
                type: "write_transition",
                code: "write_activation_failed",
                status: "failed",
              });
              return;
            }
            diagnostics.emit({
              type: "write_transition",
              code: "write_activation_started",
              status: "initializing",
            });
            await activateWrites(result.pubkey);
            writeActivationStatus = "ready";
            diagnostics.emit({
              type: "write_transition",
              code: "write_activation_ready",
              status: "ready",
            });
          }).catch(() => {
            writeActivationStatus = "failed";
            diagnostics.emit({
              type: "write_transition",
              code: "write_activation_failed",
              status: "failed",
            });
          }).finally(() => supervisor.tasks.delete(activationTask))
        : Promise.resolve();
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
          const destinations = writeDestinations.length;
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
                activationStatus: writeActivationStatus,
                destinations,
                relays: writeRelays.length,
                publication,
              },
          };
        }),
        write: signer && writeRepository
          ? {
            current: () => {
              const state = signer.current();
              const hasDestination = writeDestinations.length > 0;
              return {
                ready: state.status === "ready" && writeRepository.health() &&
                  writesActivated &&
                  config.writeIntent.mode !== "disabled" &&
                  writeRepository.boundIdentity() ===
                    `${config.writeIntent.identity.kind}:${state.pubkey}:${config.writeIntent.identity.identifier}` &&
                  writeRelays.length > 0 && hasDestination,
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

export async function launchDaemon(
  raw: RawConfig,
  hooks: ProductionHooks = {},
): Promise<LaunchResult> {
  const app = createApp(raw, createProductionDependencies(hooks));
  if (!app.ok) return app;
  let running: ReturnType<typeof startApp>;
  try {
    await app.value.readyBeforeBind();
    running = startApp(app.value, hooks.bind);
  } catch (error) {
    await app.value.closeResources();
    return {
      ok: false,
      diagnostics: Object.freeze([
        error instanceof Error ? error.message : "daemon startup failed",
      ]),
    };
  }
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
