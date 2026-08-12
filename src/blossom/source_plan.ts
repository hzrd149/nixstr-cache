import type { SourceTrust } from "../network/safe_fetcher.ts";

export interface SourceCandidate {
  readonly baseUrl: string;
  readonly origin: string;
  readonly trust: SourceTrust;
  readonly role: "local-cache" | "publisher";
}

export interface SourcePlanInput {
  readonly configured?: string | URL;
  readonly localCache?: string | URL;
  readonly event?: readonly string[];
  readonly bud03?: readonly string[];
  readonly isQuarantined?: (origin: string) => boolean;
}

function candidate(
  value: string | URL,
  trust: SourceTrust,
  role: SourceCandidate["role"],
): SourceCandidate | undefined {
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") || url.username ||
      url.password || url.search || url.hash
    ) return;
    url.pathname = url.pathname.replace(/\/+$/, "");
    return Object.freeze({
      baseUrl: url.href.replace(/\/$/, ""),
      origin: url.origin,
      trust,
      role,
    });
  } catch {
    return;
  }
}

export function buildSourcePlan(
  input: SourcePlanInput,
): readonly SourceCandidate[] {
  const ordered: Array<[string | URL, SourceTrust, SourceCandidate["role"]]> =
    [];
  if (input.localCache) {
    ordered.push([input.localCache, "configured", "local-cache"]);
  }
  if (input.configured) {
    ordered.push([input.configured, "configured", "publisher"]);
  }
  for (const value of input.event ?? []) {
    ordered.push([value, "publisher", "publisher"]);
  }
  for (const value of input.bud03 ?? []) {
    ordered.push([value, "publisher", "publisher"]);
  }
  const seen = new Set<string>();
  const result: SourceCandidate[] = [];
  for (const [value, trust, role] of ordered) {
    const item = candidate(value, trust, role);
    if (!item || seen.has(item.baseUrl) || input.isQuarantined?.(item.origin)) {
      continue;
    }
    seen.add(item.baseUrl);
    result.push(item);
  }
  return Object.freeze(result);
}
