import { VerifiedAbsent } from "../hashtree/reader.ts";
import type { WriteRepository } from "../persistence/write_repository.ts";
import type { RouteComponent } from "../persistence/blob_store.ts";

export interface SignerOverlayEntry {
  readonly route: string;
  readonly digest: string;
  readonly size: number;
  readonly path: string;
  readonly components: readonly RouteComponent[];
}
export interface SignerOverlaySnapshot {
  readonly generation: number;
  readonly entries: ReadonlyMap<string, SignerOverlayEntry>;
  readonly storePaths: ReadonlySet<string>;
}
export interface LeasedSignerOverlaySnapshot {
  readonly snapshot: SignerOverlaySnapshot;
  release(): void;
}

export class SignerOverlay {
  #snapshot: SignerOverlaySnapshot;
  constructor(readonly repository: WriteRepository) {
    this.#snapshot = this.#load();
  }
  current(): SignerOverlaySnapshot {
    return this.#snapshot;
  }
  acquire(generation = this.#snapshot.generation): LeasedSignerOverlaySnapshot {
    const snapshot = generation === this.#snapshot.generation
      ? this.#snapshot
      : this.#loadGeneration(generation);
    const release = this.repository.acquireGeneration(snapshot.generation);
    return Object.freeze({ snapshot, release });
  }
  refresh(): SignerOverlaySnapshot {
    return this.#snapshot = this.#load();
  }
  resolver(snapshot: SignerOverlaySnapshot) {
    const repository = this.repository;
    return {
      async resolve(_root: string, route: string, method: "GET" | "HEAD") {
        const entry = snapshot.entries.get(route);
        if (!entry) throw new VerifiedAbsent(route);
        if (method === "HEAD") {
          return { hash: entry.digest, size: entry.size, type: 0 as const };
        }
        if (entry.components.length) {
          const leases = entry.components.map((component) => {
            const lease = repository.blobLease(component.hash);
            if (!lease) throw new Error("overlay component unavailable");
            return lease;
          });
          let current: ReadableStreamDefaultReader<Uint8Array> | undefined;
          let index = 0;
          const release = () => {
            try {
              current?.releaseLock();
            } catch { /* terminal */ }
            for (const lease of leases) lease.release();
          };
          return {
            hash: entry.digest,
            size: entry.size,
            type: 0 as const,
            body: new ReadableStream<Uint8Array>({
              async pull(controller) {
                while (index < leases.length) {
                  const reader = current ??= leases[index].open().getReader();
                  const item = await reader.read();
                  if (!item.done) {
                    controller.enqueue(item.value);
                    return;
                  }
                  reader.releaseLock();
                  current = undefined;
                  index++;
                }
                release();
                controller.close();
              },
              cancel() {
                release();
              },
            }),
          };
        }
        const file = await Deno.open(entry.path, { read: true });
        return {
          hash: entry.digest,
          size: entry.size,
          type: 0 as const,
          body: file.readable,
        };
      },
    };
  }
  #load(): SignerOverlaySnapshot {
    return this.#loadGeneration(this.repository.currentGeneration());
  }
  #loadGeneration(generation: number): SignerOverlaySnapshot {
    const entries = new Map(
      this.repository.overlayEntries(generation).map((
        entry,
      ) => [
        entry.route,
        Object.freeze({
          route: entry.route,
          digest: entry.digest,
          size: entry.size,
          path: entry.path,
          components: entry.components ?? [],
        }),
      ]),
    );
    return Object.freeze({
      generation,
      entries,
      storePaths: this.repository.overlayStorePaths(generation),
    });
  }
}
