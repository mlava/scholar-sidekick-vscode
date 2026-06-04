// Orchestrates verification of a parsed bibliography: builds a claim per entry,
// calls verify (+ optional retraction / OA), with bounded concurrency, an
// in-memory per-identifier cache, and graceful handling of rate limits and
// abort.

import { buildClaim } from "../bib/claim";
import type { BibEntry } from "../bib/types";
import {
  ApiError,
  checkOpenAccess,
  checkRetraction,
  verify,
  type ClientOptions,
  type OaResult,
  type RetractionResult,
  type VerifyResponse,
} from "./client";

export interface RunOptions extends ClientOptions {
  checkRetraction: boolean;
  checkOpenAccess: boolean;
  maxConcurrency: number;
}

export type EntryStatus =
  | "matched"
  | "mismatch"
  | "not_found"
  | "ambiguous"
  | "unverifiable" // no resolvable identifier on the entry
  | "error"; // network / API failure for this entry

export interface EntryResult {
  entry: BibEntry;
  status: EntryStatus;
  verify?: VerifyResponse;
  retraction?: RetractionResult | null;
  openAccess?: OaResult | null;
  /** Set when status === "error" (or a partial failure occurred). */
  errorMessage?: string;
}

export interface RunSummary {
  results: EntryResult[];
  counts: {
    total: number;
    matched: number;
    mismatch: number;
    retracted: number;
    openAccess: number;
    unverifiable: number;
    errors: number;
  };
  /** True if any entry was rate-limited; the caller should advise retry. */
  rateLimited: boolean;
}

// Cache keyed by identifier for the lifetime of the extension host. Keeps
// repeated saves of the same file cheap and gentle on the API.
const verifyCache = new Map<string, VerifyResponse>();
const retractionCache = new Map<string, RetractionResult | null>();
const oaCache = new Map<string, OaResult | null>();

export function clearCache(): void {
  verifyCache.clear();
  retractionCache.clear();
  oaCache.clear();
}

export async function runVerification(
  entries: BibEntry[],
  opts: RunOptions,
): Promise<RunSummary> {
  const results = await mapWithConcurrency(
    entries,
    opts.maxConcurrency,
    (entry) => verifyEntry(entry, opts),
  );

  const counts = {
    total: results.length,
    matched: results.filter((r) => r.status === "matched").length,
    mismatch: results.filter((r) => r.status === "mismatch").length,
    retracted: results.filter((r) => r.retraction?.isRetracted).length,
    openAccess: results.filter((r) => r.openAccess?.isOa).length,
    unverifiable: results.filter((r) => r.status === "unverifiable").length,
    errors: results.filter((r) => r.status === "error").length,
  };
  const rateLimited = results.some(
    (r) => r.status === "error" && r.errorMessage === RATE_LIMIT_MESSAGE,
  );

  return { results, counts, rateLimited };
}

const RATE_LIMIT_MESSAGE = "Rate limited — try again shortly.";

async function verifyEntry(
  entry: BibEntry,
  opts: RunOptions,
): Promise<EntryResult> {
  const { claim, bestId, hasIdentifier } = buildClaim(entry);

  // The verify API requires a title; entries with neither title nor identifier
  // cannot be checked.
  if (!claim.title || !hasIdentifier) {
    return { entry, status: "unverifiable" };
  }

  try {
    const verifyRes = await cachedVerify(claim, opts);
    const result: EntryResult = {
      entry,
      status: verifyRes.verdict,
      verify: verifyRes,
    };

    if (bestId && (opts.checkRetraction || opts.checkOpenAccess)) {
      const [retraction, openAccess] = await Promise.all([
        opts.checkRetraction ? cachedRetraction(bestId, opts) : undefined,
        opts.checkOpenAccess ? cachedOpenAccess(bestId, opts) : undefined,
      ]);
      if (retraction !== undefined) {
        result.retraction = retraction;
      }
      if (openAccess !== undefined) {
        result.openAccess = openAccess;
      }
    }

    return result;
  } catch (err) {
    if (err instanceof ApiError && err.status === 429) {
      return { entry, status: "error", errorMessage: RATE_LIMIT_MESSAGE };
    }
    if (err instanceof DOMException && err.name === "AbortError") {
      throw err; // propagate cancellation
    }
    return {
      entry,
      status: "error",
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

async function cachedVerify(
  claim: ReturnType<typeof buildClaim>["claim"],
  opts: RunOptions,
): Promise<VerifyResponse> {
  const key = JSON.stringify(claim);
  const hit = verifyCache.get(key);
  if (hit) {
    return hit;
  }
  const res = await verify(claim, opts);
  verifyCache.set(key, res);
  return res;
}

async function cachedRetraction(
  id: string,
  opts: RunOptions,
): Promise<RetractionResult | null> {
  if (retractionCache.has(id)) {
    return retractionCache.get(id) ?? null;
  }
  const res = await checkRetraction(id, opts);
  retractionCache.set(id, res.result);
  return res.result;
}

async function cachedOpenAccess(
  id: string,
  opts: RunOptions,
): Promise<OaResult | null> {
  if (oaCache.has(id)) {
    return oaCache.get(id) ?? null;
  }
  const res = await checkOpenAccess(id, opts);
  oaCache.set(id, res.result);
  return res.result;
}

/** Run `fn` over `items` with at most `limit` in flight at once. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  });

  await Promise.all(workers);
  return results;
}
