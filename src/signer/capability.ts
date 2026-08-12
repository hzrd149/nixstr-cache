import type { PrivateKeySigner } from "applesauce-signers/signers/private-key-signer";
import process from "node:process";
import { BehaviorSubject, type Observable } from "rxjs";
import type { WriteIntent } from "../config/config.ts";

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
      | "ownership_mismatch";
  };

export interface PublicKeySigner {
  getPublicKey(): Promise<string>;
  close?(): Promise<void> | void;
}
export interface SignerCapability {
  readonly state: Observable<SignerState>;
  current(): SignerState;
  start(): Promise<void>;
  close(): Promise<void>;
}

export interface SignerCapabilityOptions {
  readonly intent: WriteIntent;
  readonly localKeyPath?: string;
  readonly nip46SessionPath?: string;
  readonly createNip46Signer?: (
    session: string,
    permissionKind: 17091 | 37091,
  ) => Promise<PublicKeySigner>;
}

async function readProtected(path: string): Promise<Uint8Array> {
  const stat = await Deno.stat(path);
  if (!stat.isFile || stat.mode === null || (stat.mode & 0o077) !== 0) {
    throw new ProtectedSourceError();
  }
  return await Deno.readFile(path);
}

class ProtectedSourceError extends Error {}

async function privateKeySignerFromKey(
  key: Uint8Array,
): Promise<PrivateKeySigner> {
  // debug's Node entrypoint enumerates process.env at module initialization.
  // It is irrelevant to signing and would otherwise widen the daemon permission set.
  const environment = process.env;
  try {
    process.env = {};
    const { PrivateKeySigner } = await import(
      "applesauce-signers/signers/private-key-signer"
    );
    return PrivateKeySigner.fromKey(key);
  } finally {
    process.env = environment;
  }
}

export function createSignerCapability(
  options: SignerCapabilityOptions,
): SignerCapability {
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
      if (closed || options.intent.mode === "disabled") return;
      subject.next(Object.freeze({ status: "connecting" }));
      let owned: Uint8Array | undefined;
      try {
        if (options.intent.mode === "local") {
          if (!options.localKeyPath) throw new ProtectedSourceError();
          owned = await readProtected(options.localKeyPath);
          if (owned.length !== 32) throw new TypeError("invalid local key");
          // Keep the phase-3 boundary status-only; publication APIs are omitted.
          const signer = await privateKeySignerFromKey(owned.slice());
          retainedKey = signer.key;
          active = signer satisfies Pick<PrivateKeySigner, "getPublicKey">;
        } else {
          if (!options.nip46SessionPath || !options.createNip46Signer) {
            throw new ProtectedSourceError();
          }
          owned = await readProtected(options.nip46SessionPath);
          active = await options.createNip46Signer(
            new TextDecoder("utf-8", { fatal: true }).decode(owned).trim(),
            options.intent.identity.kind,
          );
        }
        const pubkey = await active.getPublicKey();
        if (pubkey !== options.intent.identity.pubkey) {
          await active.close?.();
          active = undefined;
          subject.next(
            Object.freeze({ status: "failed", code: "ownership_mismatch" }),
          );
          return;
        }
        subject.next(Object.freeze({ status: "ready", pubkey }));
      } catch (error) {
        try {
          await active?.close?.();
        } catch { /* sanitized failure state only */ }
        active = undefined;
        retainedKey?.fill(0);
        retainedKey = undefined;
        const code = error instanceof ProtectedSourceError
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
  };
}
