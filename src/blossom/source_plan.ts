import type { SourceTrust } from "../network/safe_fetcher.ts";

export interface SourceCandidate {
  readonly baseUrl: string;
  readonly origin: string;
  readonly trust: SourceTrust;
  readonly role: "publisher";
}

export interface SourcePlanInput {
  readonly extras?: readonly (string | URL)[];
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
  for (const value of input.event ?? []) {
    ordered.push([value, "publisher", "publisher"]);
  }
  for (const value of input.bud03 ?? []) {
    ordered.push([value, "publisher", "publisher"]);
  }
  for (const value of input.extras ?? []) {
    ordered.push([value, "configured", "publisher"]);
  }
  const seen = new Map<string, number>();
  const result: SourceCandidate[] = [];
  for (const [value, trust, role] of ordered) {
    const item = candidate(value, trust, role);
    if (!item || input.isQuarantined?.(item.origin)) {
      continue;
    }
    const existing = seen.get(item.baseUrl);
    if (existing !== undefined) {
      if (
        item.trust === "configured" && result[existing].trust !== "configured"
      ) {
        result[existing] = item;
      }
      continue;
    }
    seen.set(item.baseUrl, result.length);
    result.push(item);
  }
  return Object.freeze(result);
}
