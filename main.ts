import type { RawConfig } from "./src/config/config.ts";
import { launchDaemon } from "./src/runtime/daemon.ts";

export function rawConfigFromEnvironment(
  environment: Record<string, string>,
): RawConfig {
  return {
    bindHost: environment.NIXSTR_BIND_HOST,
    bindPort: environment.NIXSTR_BIND_PORT,
    publisherPubkeys: environment.NIXSTR_PUBLISHER_PUBKEYS,
    relayUrls: environment.NIXSTR_RELAY_URLS,
    preferredBlossomUrl: environment.NIXSTR_PREFERRED_BLOSSOM_URL,
    databasePath: environment.NIXSTR_DATABASE_PATH,
    spoolDirectory: environment.NIXSTR_SPOOL_DIRECTORY,
    limits: {
      manifestWireBytes: environment.NIXSTR_LIMIT_MANIFEST_WIRE_BYTES,
      decodedMetadataBytes: environment.NIXSTR_LIMIT_DECODED_METADATA_BYTES,
      blobTransferBytes: environment.NIXSTR_LIMIT_BLOB_TRANSFER_BYTES,
      requestTransferBytes: environment.NIXSTR_LIMIT_REQUEST_TRANSFER_BYTES,
      requestOutputBytes: environment.NIXSTR_LIMIT_REQUEST_OUTPUT_BYTES,
      traversalDepth: environment.NIXSTR_LIMIT_TRAVERSAL_DEPTH,
      linksPerNode: environment.NIXSTR_LIMIT_LINKS_PER_NODE,
      uniqueManifestNodes: environment.NIXSTR_LIMIT_UNIQUE_MANIFEST_NODES,
      totalDecodedManifestBytes:
        environment.NIXSTR_LIMIT_TOTAL_DECODED_MANIFEST_BYTES,
      sourceAttempts: environment.NIXSTR_LIMIT_SOURCE_ATTEMPTS,
      maxRedirects: environment.NIXSTR_LIMIT_MAX_REDIRECTS,
      connectTimeoutMs: environment.NIXSTR_LIMIT_CONNECT_TIMEOUT_MS,
      idleTimeoutMs: environment.NIXSTR_LIMIT_IDLE_TIMEOUT_MS,
      totalTimeoutMs: environment.NIXSTR_LIMIT_TOTAL_TIMEOUT_MS,
      concurrentFetches: environment.NIXSTR_LIMIT_CONCURRENT_FETCHES,
    },
  };
}

if (import.meta.main) {
  const result = await launchDaemon(
    rawConfigFromEnvironment(Deno.env.toObject()),
  );
  if (!result.ok) {
    for (const diagnostic of result.diagnostics) console.error(diagnostic);
    Deno.exit(1);
  }
  await result.finished;
}
