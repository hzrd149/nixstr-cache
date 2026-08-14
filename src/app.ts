import {
  parseConfig,
  type RawConfig,
  type ValidatedConfig,
} from "./config/config.ts";

interface CloseableRepository {
  close(): void;
}
interface DisposableSelection {
  dispose(): unknown | Promise<unknown>;
  readyBeforeBind?(): Promise<void>;
}

export interface AppDependencies {
  openRepository(config: ValidatedConfig): CloseableRepository;
  createSelection(
    repository: CloseableRepository,
    config: ValidatedConfig,
  ): DisposableSelection;
  createHandler(
    selection: DisposableSelection,
    config: ValidatedConfig,
  ): HttpHandler;
}

export type HttpHandler = (
  request: Request,
  info?: Pick<Deno.ServeHandlerInfo, "completed">,
) => Response | Promise<Response>;

export interface DaemonApp {
  readonly config: ValidatedConfig;
  readonly handler: HttpHandler;
  readyBeforeBind(): Promise<void>;
  closeResources(): Promise<void>;
}

export type CreateAppResult =
  | { readonly ok: true; readonly value: DaemonApp }
  | { readonly ok: false; readonly diagnostics: readonly string[] };

export function createApp(
  raw: RawConfig,
  dependencies: AppDependencies,
): CreateAppResult {
  const parsed = parseConfig(raw);
  if (!parsed.ok) {
    return {
      ok: false,
      diagnostics: Object.freeze(
        parsed.diagnostics.map((item) => `${item.field}: ${item.message}`),
      ),
    };
  }
  let repository: CloseableRepository | undefined;
  let selection: DisposableSelection | undefined;
  try {
    repository = dependencies.openRepository(parsed.value);
    selection = dependencies.createSelection(repository, parsed.value);
    const handler = dependencies.createHandler(selection, parsed.value);
    return {
      ok: true,
      value: Object.freeze({
        config: parsed.value,
        handler,
        readyBeforeBind: () =>
          selection?.readyBeforeBind?.() ?? Promise.resolve(),
        async closeResources() {
          try {
            await selection?.dispose();
          } finally {
            repository?.close();
          }
        },
      }),
    };
  } catch (error) {
    try {
      void selection?.dispose();
    } finally {
      repository?.close();
    }
    return {
      ok: false,
      diagnostics: Object.freeze([
        error instanceof Error ? error.message : String(error),
      ]),
    };
  }
}

export interface Listener {
  shutdown(): Promise<void>;
}
export type Bind = (
  handler: HttpHandler,
  options: { hostname: string; port: number; signal: AbortSignal },
) => Listener;

export function startApp(
  app: DaemonApp,
  bind: Bind = denoBind,
): { shutdown(): Promise<void> } {
  const abort = new AbortController();
  const listener = bind(app.handler, {
    hostname: app.config.bindHost,
    port: app.config.bindPort,
    signal: abort.signal,
  });
  let stopped = false;
  return {
    async shutdown() {
      if (stopped) return;
      stopped = true;
      abort.abort();
      try {
        await listener.shutdown();
      } finally {
        await app.closeResources();
      }
    },
  };
}

function denoBind(
  handler: HttpHandler,
  options: { hostname: string; port: number; signal: AbortSignal },
): Listener {
  const server = Deno.serve(options, handler);
  return { shutdown: () => server.shutdown() };
}
