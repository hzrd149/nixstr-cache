export interface PasswordPromptIO {
  readonly isTerminal: () => boolean;
  readonly setRaw: (raw: boolean) => void;
  readonly read: (buffer: Uint8Array) => Promise<number | null>;
  readonly write: (data: Uint8Array) => Promise<number>;
}

export type PasswordRequest = () => Promise<string>;

export function createPasswordRequest(
  io: PasswordPromptIO = {
    isTerminal: () => Deno.stdin.isTerminal(),
    setRaw: (raw) => Deno.stdin.setRaw(raw),
    read: (buffer) => Deno.stdin.read(buffer),
    write: (data) => Deno.stderr.write(data),
  },
  maxBytes = 1024,
): PasswordRequest {
  return async () => {
    const terminal = io.isTerminal();
    const bytes: number[] = [];
    if (terminal) {
      await io.write(new TextEncoder().encode("Unlock ncryptsec signer: "));
      io.setRaw(true);
    }
    try {
      const one = new Uint8Array(1);
      while (true) {
        const count = await io.read(one);
        if (count === null) {
          if (bytes.length === 0) throw new Error("password input unavailable");
          if (!terminal) {
            throw new Error("password input must end with newline");
          }
          break;
        }
        if (count === 0) continue;
        const byte = one[0];
        if (byte === 10 || byte === 13) break;
        if (terminal && byte === 3) throw new Error("password input cancelled");
        if (terminal && (byte === 8 || byte === 127)) {
          bytes.pop();
          continue;
        }
        if (bytes.length >= maxBytes) {
          throw new Error("password input too long");
        }
        bytes.push(byte);
      }
      if (bytes.length === 0) throw new Error("password input is empty");
      try {
        return new TextDecoder("utf-8", { fatal: true }).decode(
          Uint8Array.from(bytes),
        );
      } catch {
        throw new Error("password input is not valid UTF-8");
      }
    } finally {
      bytes.fill(0);
      if (terminal) {
        try {
          io.setRaw(false);
        } finally {
          await io.write(new Uint8Array([10]));
        }
      }
    }
  };
}
