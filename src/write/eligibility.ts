import type { WriteRepository } from "../persistence/write_repository.ts";
import type { SignerOverlay } from "./overlay.ts";
import type { Subscription } from "rxjs";

export interface EligibilityOptions {
  readonly maxVisited: number;
  readonly maxMetadataBytes: number;
  readonly lowerHasStorePath: (
    storePathHash: string,
  ) => boolean | Promise<boolean>;
}

export class EligibilityModel {
  #serial = Promise.resolve(false);
  constructor(
    readonly repository: WriteRepository,
    readonly overlay: SignerOverlay,
    readonly options: EligibilityOptions,
  ) {}
  changed(routeOrStorePath: string): Promise<boolean> {
    const next = this.#serial.then(() => this.#recompute(routeOrStorePath));
    this.#serial = next.catch(() => false);
    return next;
  }
  start(): Subscription {
    return this.repository.changes$.subscribe((route) => {
      void this.changed(route);
    });
  }
  idle(): Promise<boolean> {
    return this.#serial;
  }
  async #recompute(changed: string): Promise<boolean> {
    const candidates = this.repository.affectedCandidates(
      changed,
      this.options.maxVisited,
    );
    let metadata = 0;
    for (const candidate of candidates) {
      metadata += candidate.metadataBytes;
      if (metadata > this.options.maxMetadataBytes) {
        throw new RangeError("eligibility metadata ceiling exceeded");
      }
    }
    const committed = this.repository.currentOverlayStorePaths();
    const admitted = new Set<string>();
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const candidate of candidates) {
        if (
          committed.has(candidate.storePathHash) ||
          admitted.has(candidate.storePathHash)
        ) continue;
        if (!this.repository.lookup(candidate.narRoute)) continue;
        let closed = true;
        for (const reference of candidate.references) {
          if (
            !committed.has(reference) && !admitted.has(reference) &&
            !await this.options.lowerHasStorePath(reference)
          ) {
            closed = false;
            break;
          }
        }
        if (closed) {
          admitted.add(candidate.storePathHash);
          progressed = true;
        }
      }
    }
    if (!admitted.size) return false;
    this.repository.commitOverlay([...admitted]);
    this.overlay.refresh();
    return true;
  }
}
