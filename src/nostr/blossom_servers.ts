import type { NostrEvent } from "nostr-tools";

/** Strict BUD-03 projection. Invalid entries are ignored without disturbing order. */
export function projectBlossomServers(
  event: NostrEvent,
  publishers: ReadonlySet<string>,
): readonly string[] {
  if (event.kind !== 10063 || !publishers.has(event.pubkey)) return [];
  const result: string[] = [];
  for (const tag of event.tags) {
    if (tag.length !== 2 || tag[0] !== "server") continue;
    try {
      const url = new URL(tag[1]);
      if (
        (url.protocol !== "http:" && url.protocol !== "https:") ||
        url.username || url.password || url.search || url.hash
      ) continue;
      result.push(tag[1]);
    } catch { /* malformed publisher entry */ }
  }
  return Object.freeze(result);
}
