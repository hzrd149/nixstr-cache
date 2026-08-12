import { verifyEvent } from "nostr-tools";
import type { RawPublication } from "../protocol/publication.ts";

export type LocalRelayPublisher = (
  relay: string,
  event: RawPublication,
) => Promise<boolean>;

/** Credential-free write-through boundary for already verified public Nostr events. */
export class LocalRelayCache {
  readonly #relay: string;
  constructor(relay: string | URL, readonly publish: LocalRelayPublisher) {
    const url = new URL(relay);
    if (
      !(url.protocol === "ws:" || url.protocol === "wss:") || url.username ||
      url.password
    ) {
      throw new TypeError("local relay must be a credential-free WS(S) URL");
    }
    this.#relay = url.href;
  }
  acceptObserved(event: RawPublication): Promise<boolean> {
    try {
      if (!verifyEvent(event)) return Promise.resolve(false);
    } catch {
      return Promise.resolve(false);
    }
    return this.publish(this.#relay, event);
  }
  publishSigned(event: RawPublication): Promise<boolean> {
    try {
      if (!verifyEvent(event)) return Promise.resolve(false);
    } catch {
      return Promise.resolve(false);
    }
    return this.publish(this.#relay, event);
  }
  get relay(): string {
    return this.#relay;
  }
}
