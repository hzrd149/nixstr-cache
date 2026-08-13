import { PrivateKeySigner } from "applesauce-signers/signers/private-key-signer";
import { PasswordSigner } from "applesauce-signers";
import { BehaviorSubject, type Observable } from "rxjs";
import type { WriteIntent } from "../config/config.ts";
import type { EventTemplate, VerifiedEvent } from "nostr-tools";
import type { PasswordRequest } from "../runtime/password_prompt.ts";

export type SignerState =
  | { readonly status: "disconnected" }
  | { readonly status: "connecting" }
  | { readonly status: "ready"; readonly pubkey: string }
  | {
    readonly status: "failed";
    readonly code:
      | "protected_source"
      | "invalid_source"
      | "connection"
      | "password_unavailable"
      | "identity_changed";
  };

export interface PublicKeySigner {
  getPublicKey(): Promise<string>;
  signEvent?(template: EventTemplate): Promise<VerifiedEvent>;
  close?(): Promise<void> | void;
}
export interface SignerCapability {
  readonly state: Observable<SignerState>;
  current(): SignerState;
  start(): Promise<void>;
  assertIdentity(): Promise<string>;
  close(): Promise<void>;
  signEvent(
    template: EventTemplate,
    signal?: AbortSignal,
  ): Promise<VerifiedEvent>;
}

export interface SignerCapabilityOptions {
  readonly intent: WriteIntent;
  readonly createNip46Signer?: (
    session: string,
    permissionKind: 17091 | 37091,
  ) => Promise<PublicKeySigner>;
  readonly requestPassword?: PasswordRequest;
}

async function readProtected(path: string): Promise<Uint8Array> {
  const stat = await Deno.stat(path);
  if (!stat.isFile || stat.mode === null || (stat.mode & 0o077) !== 0) {
    throw new ProtectedSourceError();
  }
  return await Deno.readFile(path);
}

class ProtectedSourceError extends Error {}

export function createSignerCapability(
  options: SignerCapabilityOptions,
): SignerCapability {
  const intent = options.intent;
  const subject = new BehaviorSubject<SignerState>(
    Object.freeze({ status: "disconnected" }),
  );
  let active: PublicKeySigner | undefined;
  let retainedKey: Uint8Array | undefined;
  let closed = false;
  return {
    state: subject.asObservable(),
    current: () => subject.value,
    async start() {
      if (closed || intent.mode === "disabled") return;
      subject.next(Object.freeze({ status: "connecting" }));
      let owned: Uint8Array | undefined;
      try {
        if (intent.mode === "local") {
          owned = await readProtected(intent.signerPath);
          if (owned.length !== 32) throw new TypeError("invalid local key");
          // Keep the phase-3 boundary status-only; publication APIs are omitted.
          const signer = PrivateKeySigner.fromKey(owned.slice());
          retainedKey = signer.key;
          active = signer satisfies Pick<PrivateKeySigner, "getPublicKey">;
        } else if (intent.mode === "nip46") {
          if (!options.createNip46Signer) {
            throw new ProtectedSourceError();
          }
          owned = await readProtected(intent.signerPath);
          active = await options.createNip46Signer(
            new TextDecoder("utf-8", { fatal: true }).decode(owned).trim(),
            intent.identity.kind,
          );
        } else {
          if (intent.mode !== "ncryptsec") return;
          if (!options.requestPassword) throw new PasswordUnavailableError();
          const encryptedKey = intent.ncryptsec;
          let password: string;
          try {
            password = await options.requestPassword();
          } catch {
            throw new PasswordUnavailableError();
          }
          try {
            const signer = await PasswordSigner.fromNcryptsec(
              encryptedKey,
              password,
            );
            if (!signer.key || signer.key.length !== 32) {
              throw new TypeError("invalid encrypted key");
            }
            retainedKey = signer.key;
            active = {
              getPublicKey: () => signer.getPublicKey(),
              signEvent: (template) => signer.signEvent(template),
              close() {
                signer.key?.fill(0);
                signer.lock();
              },
            };
          } catch {
            throw new TypeError("invalid encrypted key");
          } finally {
            password = "";
          }
        }
        const pubkey = await active.getPublicKey();
        subject.next(Object.freeze({ status: "ready", pubkey }));
      } catch (error) {
        try {
          await active?.close?.();
        } catch { /* sanitized failure state only */ }
        active = undefined;
        retainedKey?.fill(0);
        retainedKey = undefined;
        const code = error instanceof PasswordUnavailableError
          ? "password_unavailable"
          : error instanceof ProtectedSourceError
          ? "protected_source"
          : error instanceof TypeError
          ? "invalid_source"
          : "connection";
        subject.next(Object.freeze({ status: "failed", code }));
      } finally {
        owned?.fill(0);
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      try {
        await active?.close?.();
      } finally {
        active = undefined;
        retainedKey?.fill(0);
        retainedKey = undefined;
        subject.next(Object.freeze({ status: "disconnected" }));
        subject.complete();
      }
    },
    async assertIdentity() {
      const state = subject.value;
      if (closed || state.status !== "ready" || !active) {
        throw new Error("signer is not ready");
      }
      const pubkey = await active.getPublicKey();
      if (pubkey !== state.pubkey) {
        subject.next(
          Object.freeze({ status: "failed", code: "identity_changed" }),
        );
        throw new Error("signer ownership changed");
      }
      return pubkey;
    },
    async signEvent(template, signal) {
      signal?.throwIfAborted();
      const state = subject.value;
      if (
        closed || state.status !== "ready" || !active?.signEvent ||
        intent.mode === "disabled"
      ) {
        throw new Error("signer is not ready");
      }
      const pubkey = await this.assertIdentity();
      const operation = active.signEvent(template);
      const event = signal
        ? await Promise.race([
          operation,
          new Promise<never>((_, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            });
          }),
        ])
        : await operation;
      signal?.throwIfAborted();
      await this.assertIdentity();
      if (event.pubkey !== pubkey) {
        throw new Error("signer returned foreign event");
      }
      return event;
    },
  };
}

class PasswordUnavailableError extends Error {}
