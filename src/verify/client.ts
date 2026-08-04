// Thin client over the Scholar Sidekick public REST API.
//
// Endpoints used (all anonymous-capable; optional `ssk_` Bearer for higher
// rate limits):
//   POST /api/verify           { claimed }      → verdict + resolved record
//   POST /api/retraction-check { id }           → retraction status
//   POST /api/oa-check         { id }           → open-access status
//
// Node 18+ / VS Code 1.85+ ships a global `fetch`, so there is no runtime
// dependency here.

import type { Claim } from "../bib/claim";

export interface ClientOptions {
  apiBase: string;
  apiKey: string;
  /**
   * This extension's version, used only to complete the `X-Scholar-Client`
   * handshake tag. Optional on purpose: the tag is sent either way, so a caller
   * that omits this loses the version in the server's usage record but never
   * the surface attribution. See `clientTag()`.
   */
  clientVersion?: string;
  signal?: AbortSignal;
}

/** The client-tag suffix the server maps to the `vscode` usage surface. */
const CLIENT_NAME = "scholar-sidekick-vscode";

/**
 * Build the `X-Scholar-Client` handshake tag.
 *
 * The server parses `scholar-sidekick-<name>[/<version>]` and maps `<name>`
 * through a closed lookup table; an unrecognised name falls through to the
 * generic `api` surface. Sending nothing at all is worse still — this extension
 * previously sent no tag, so the `vscode` surface existed server-side and
 * recorded zero rows, and its calls were indistinguishable from raw REST
 * traffic. The tag is therefore unconditional, and only the version is optional
 * (the server's grammar accepts a bare name).
 */
export function clientTag(version?: string): string {
  const safe = version?.trim().match(/^[a-z0-9.+-]+$/i)?.[0];
  return safe ? `${CLIENT_NAME}/${safe}` : CLIENT_NAME;
}

export type Verdict = "matched" | "mismatch" | "not_found" | "ambiguous";
export type Confidence = "high" | "medium" | "low";

export interface ResolvedRecord {
  title?: string;
  authors?: { family: string; given?: string }[];
  "container-title"?: string;
  issued?: { "date-parts"?: number[][] };
  DOI?: string;
}

export interface VerifyResponse {
  ok: boolean;
  verdict: Verdict;
  confidence: Confidence;
  matched: ResolvedRecord | null;
  mismatches?: { field: string; claimed: unknown; resolved: unknown }[];
  error?: string;
}

export interface RetractionNotice {
  type: string; // "retraction" | "correction" | "expression-of-concern" | …
  label: string;
  date: string | null;
  source: string | null;
}

export interface RetractionResult {
  isRetracted: boolean;
  hasCorrections: boolean;
  hasConcern: boolean;
  notices: RetractionNotice[];
  title: string | null;
}

export interface RetractionResponse {
  ok: boolean;
  doi?: string;
  result: RetractionResult | null;
  error?: string;
}

export interface OaLocation {
  url: string;
  hostType: string;
  license: string | null;
  version: string | null;
}

export interface OaResult {
  isOa: boolean;
  oaStatus: "gold" | "green" | "hybrid" | "bronze" | "closed";
  title: string | null;
  bestLocation: OaLocation | null;
  locations: OaLocation[];
}

export interface OpenAccessResponse {
  ok: boolean;
  doi?: string;
  result: OaResult | null;
  error?: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function post<T>(
  path: string,
  body: unknown,
  opts: ClientOptions,
): Promise<T> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
    "x-scholar-client": clientTag(opts.clientVersion),
  };
  if (opts.apiKey) {
    headers.authorization = `Bearer ${opts.apiKey}`;
  }

  const res = await fetch(joinUrl(opts.apiBase, path), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: opts.signal,
  });

  if (res.status === 429) {
    const retryAfter = res.headers.get("retry-after");
    const retryAfterMs = retryAfter
      ? Number.parseInt(retryAfter, 10) * 1000
      : undefined;
    throw new ApiError("Rate limited", 429, retryAfterMs);
  }

  if (!res.ok) {
    let detail = "";
    try {
      const json = (await res.json()) as { error?: string };
      detail = json?.error ? `: ${json.error}` : "";
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(`${path} returned ${res.status}${detail}`, res.status);
  }

  return (await res.json()) as T;
}

export function verify(claim: Claim, opts: ClientOptions): Promise<VerifyResponse> {
  return post<VerifyResponse>("/api/verify", { claimed: claim }, opts);
}

export function checkRetraction(
  id: string,
  opts: ClientOptions,
): Promise<RetractionResponse> {
  return post<RetractionResponse>("/api/retraction-check", { id }, opts);
}

export function checkOpenAccess(
  id: string,
  opts: ClientOptions,
): Promise<OpenAccessResponse> {
  return post<OpenAccessResponse>("/api/oa-check", { id }, opts);
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}${path}`;
}
