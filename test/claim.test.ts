import { describe, expect, it } from "vitest";

import { buildClaim } from "../src/bib/claim";
import type { BibEntry } from "../src/bib/types";

function entry(fields: Record<string, string>, type = "article"): BibEntry {
  return { type, key: "k", fields, start: 0, end: 0 };
}

describe("buildClaim", () => {
  it("maps core fields and normalizes a bare DOI", () => {
    const { claim, bestId, hasIdentifier } = buildClaim(
      entry({
        title: "Array programming with NumPy",
        journal: "Nature",
        year: "2020",
        doi: "10.1038/s41586-020-2649-2",
      }),
    );
    expect(claim.title).toBe("Array programming with NumPy");
    expect(claim.container).toBe("Nature");
    expect(claim.year).toBe(2020);
    expect(claim.doi).toBe("10.1038/s41586-020-2649-2");
    expect(bestId).toBe("10.1038/s41586-020-2649-2");
    expect(hasIdentifier).toBe(true);
  });

  it("strips a doi.org URL prefix from the DOI", () => {
    const { claim } = buildClaim(entry({ title: "T", doi: "https://doi.org/10.1/abc" }));
    expect(claim.doi).toBe("10.1/abc");
  });

  it("extracts a DOI embedded in a url field", () => {
    const { claim } = buildClaim(
      entry({ title: "T", url: "https://example.org/10.1038/s41586-020-2649-2" }),
    );
    expect(claim.doi).toBe("10.1038/s41586-020-2649-2");
  });

  it("parses 'Family, Given' authors", () => {
    const { claim } = buildClaim(
      entry({ title: "T", doi: "10.1/x", author: "Vaswani, Ashish and Shazeer, Noam" }),
    );
    expect(claim.authors).toEqual([
      { family: "Vaswani", given: "Ashish" },
      { family: "Shazeer", given: "Noam" },
    ]);
  });

  it("parses 'Given Family' authors", () => {
    const { claim } = buildClaim(
      entry({ title: "T", doi: "10.1/x", author: "Ashish Vaswani and Noam Shazeer" }),
    );
    expect(claim.authors).toEqual([
      { family: "Vaswani", given: "Ashish" },
      { family: "Shazeer", given: "Noam" },
    ]);
  });

  it("derives a year from a date field", () => {
    const { claim } = buildClaim(entry({ title: "T", doi: "10.1/x", date: "2019-03-01" }));
    expect(claim.year).toBe(2019);
  });

  it("extracts arXiv from eprint + archivePrefix", () => {
    const { claim, bestId } = buildClaim(
      entry({ title: "T", eprint: "2305.12345", archiveprefix: "arXiv" }, "misc"),
    );
    expect(claim.arxiv).toBe("2305.12345");
    expect(bestId).toBe("arXiv:2305.12345");
  });

  it("prefers DOI over other identifiers for bestId", () => {
    const { bestId } = buildClaim(
      entry({ title: "T", doi: "10.1/x", pmid: "123", isbn: "978" }),
    );
    expect(bestId).toBe("10.1/x");
  });

  it("flags entries with no resolvable identifier as unverifiable", () => {
    const { hasIdentifier, bestId } = buildClaim(
      entry({ title: "The TeXbook", author: "Knuth, Donald E.", year: "1984" }, "book"),
    );
    expect(hasIdentifier).toBe(false);
    expect(bestId).toBeNull();
  });

  it("ignores a non-DOI value in the doi field", () => {
    const { claim } = buildClaim(entry({ title: "T", doi: "not-a-doi" }));
    expect(claim.doi).toBeUndefined();
  });
});
