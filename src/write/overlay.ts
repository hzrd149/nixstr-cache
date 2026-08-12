import { VerifiedAbsent } from "../hashtree/reader.ts";
import type { WriteRepository } from "../persistence/write_repository.ts";

export interface SignerOverlayEntry {
  readonly route: string;
  readonly digest: string;
  readonly size: number;
  readonly path: string;
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
    return {
      async resolve(_root: string, route: string, method: "GET" | "HEAD") {
        const entry = snapshot.entries.get(route);
        if (!entry) throw new VerifiedAbsent(route);
        if (method === "HEAD") {
          return { hash: entry.digest, size: entry.size, type: 0 as const };
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
