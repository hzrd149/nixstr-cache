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

export class SignerOverlay {
  #snapshot: SignerOverlaySnapshot;
  constructor(readonly repository: WriteRepository) {
    this.#snapshot = this.#load();
  }
  current(): SignerOverlaySnapshot {
    return this.#snapshot;
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
    const entries = new Map(
      this.repository.currentOverlayEntries().map((
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
      generation: this.repository.currentGeneration(),
      entries,
      storePaths: this.repository.currentOverlayStorePaths(),
    });
  }
}
