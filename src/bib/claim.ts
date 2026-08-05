// Translate a parsed BibTeX entry into the Scholar Sidekick verify "claimed"
// shape, and pick the single best identifier for the retraction / OA lookups
// (which take one `id` string).

import type { BibEntry } from "./types";

export interface AuthorClaim {
  family: string;
  given?: string;
}

export interface Claim {
  title?: string;
  authors?: AuthorClaim[];
  year?: number;
  container?: string;
  doi?: string;
  pmid?: string;
  pmcid?: string;
  isbn?: string;
  arxiv?: string;
  issn?: string;
  ads?: string;
}

export interface EntryClaim {
  claim: Claim;
  /** Best single identifier string for /api/retraction-check + /api/oa-check. */
  bestId: string | null;
  /** True if the entry carries any resolvable identifier. */
  hasIdentifier: boolean;
}

export function buildClaim(entry: BibEntry): EntryClaim {
  const f = entry.fields;
  const claim: Claim = {};

  if (f.title) {
    claim.title = f.title;
  }

  const authors = parseAuthors(entry.names?.author);
  if (authors.length > 0) {
    claim.authors = authors.slice(0, 50);
  }

  const year = parseYear(f.year ?? f.date);
  if (year !== null) {
    claim.year = year;
  }

  const container = f.journal ?? f.journaltitle ?? f.booktitle;
  if (container) {
    claim.container = container;
  }

  const doi = normalizeDoi(f.doi ?? extractDoiFromUrl(f.url));
  if (doi) {
    claim.doi = doi;
  }
  if (f.pmid) {
    claim.pmid = f.pmid.trim();
  }
  if (f.pmcid) {
    claim.pmcid = f.pmcid.trim();
  }
  if (f.isbn) {
    claim.isbn = f.isbn.trim();
  }
  const arxiv = extractArxiv(f);
  if (arxiv) {
    claim.arxiv = arxiv;
  }
  if (f.issn) {
    claim.issn = f.issn.trim();
  }
  const ads = f.bibcode ?? extractBibcodeFromUrl(f.adsurl);
  if (ads) {
    claim.ads = ads.trim();
  }

  const bestId =
    claim.doi ??
    (claim.pmid ? `PMID:${claim.pmid}` : null) ??
    (claim.pmcid ?? null) ??
    (claim.arxiv ? `arXiv:${claim.arxiv}` : null) ??
    (claim.isbn ?? null) ??
    (claim.ads ?? null);

  return {
    claim,
    bestId,
    hasIdentifier: bestId !== null,
  };
}

/**
 * `others` is BibTeX's "et al." sentinel (`author = {Smith, John and others}`),
 * not a person. Sending it as a claimed co-author makes the server look for
 * someone named "others" on the resolved record, fail, and downgrade the verdict
 * to `ambiguous` — a false review flag on a correctly-cited paper. Drop it.
 */
const NAME_SENTINELS = new Set(["others", "et al", "et al."]);

function parseAuthors(names: string[] | undefined): AuthorClaim[] {
  if (!names || names.length === 0) {
    return [];
  }
  return names
    .map((name) => name.trim())
    .filter((name) => name && !NAME_SENTINELS.has(name.toLowerCase()))
    .map(parseOneAuthor);
}

function parseOneAuthor(name: string): AuthorClaim {
  // Brace-wrapped by the parser = a protected corporate name. Atomic: the whole
  // string is the "family" name, exactly as the registries hold it.
  if (name.startsWith("{") && name.endsWith("}")) {
    return { family: name.slice(1, -1).trim() };
  }

  if (name.includes(",")) {
    // BibTeX name forms: "Last, First" and the 3-part "Last, Suffix, First".
    // Splitting with a limit of 2 read the suffix as the given name, so
    // "King, Jr., Martin Luther" lost "Martin Luther" entirely.
    const parts = name.split(",").map((s) => s.trim());
    const family = parts[0];
    const given = (parts.length >= 3 ? parts[2] : parts[1]) || "";
    return given ? { family, given } : { family };
  }

  // "Given … Family" — last whitespace-separated token is the family name.
  const parts = name.split(/\s+/);
  if (parts.length === 1) {
    return { family: parts[0] };
  }
  const family = parts[parts.length - 1];
  const given = parts.slice(0, -1).join(" ");
  return { family, given };
}

function parseYear(raw: string | undefined): number | null {
  if (!raw) {
    return null;
  }
  const match = raw.match(/\d{4}/);
  if (!match) {
    return null;
  }
  const year = Number.parseInt(match[0], 10);
  return Number.isFinite(year) ? year : null;
}

function normalizeDoi(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }
  const doi = raw.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
  return doi.startsWith("10.") ? doi : undefined;
}

function extractDoiFromUrl(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }
  const match = url.match(/10\.\d{4,9}\/[^\s"]+/);
  return match ? match[0] : undefined;
}

function extractArxiv(f: Record<string, string>): string | undefined {
  const prefix = (f.archiveprefix ?? f.eprinttype ?? "").toLowerCase();
  if (f.eprint && (prefix === "arxiv" || prefix === "")) {
    return f.eprint.trim().replace(/^arxiv:/i, "");
  }
  if (f.arxiv) {
    return f.arxiv.trim().replace(/^arxiv:/i, "");
  }
  return undefined;
}

function extractBibcodeFromUrl(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }
  const match = url.match(/abs\/([^/]+)/);
  return match ? decodeURIComponent(match[1]) : undefined;
}
