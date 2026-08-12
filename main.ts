import { type AppDependencies, createApp, startApp } from "./src/app.ts";
import type { RawConfig } from "./src/config/config.ts";

export function rawConfigFromEnvironment(
  environment: Record<string, string>,
): RawConfig {
  return {
    bindHost: environment.NIXSTR_BIND_HOST,
    bindPort: environment.NIXSTR_BIND_PORT,
    publisherPubkeys: environment.NIXSTR_PUBLISHER_PUBKEYS,
    relayUrls: environment.NIXSTR_RELAY_URLS,
    preferredBlossomUrl: environment.NIXSTR_PREFERRED_BLOSSOM_URL,
  };
}

export async function run(dependencies: AppDependencies): Promise<number> {
  const result = await createApp(
    rawConfigFromEnvironment(Deno.env.toObject()),
    dependencies,
  );
  if (!result.ok) {
    for (const diagnostic of result.diagnostics) console.error(diagnostic);
    return 1;
  }
  startApp(result.value);
  return 0;
}

if (import.meta.main) {
  console.error(
    "runtime relay/resolver composition is supplied by the daemon launcher",
  );
  Deno.exit(1);
}
