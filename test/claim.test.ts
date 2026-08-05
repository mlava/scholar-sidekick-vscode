import { describe, expect, it } from "vitest";

import { buildClaim } from "../src/bib/claim";
import { parseBibtex } from "../src/bib/parse";
import type { BibEntry } from "../src/bib/types";

// Build the entry by running the REAL parser over real BibTeX rather than
// hand-assembling a BibEntry. Author handling depends on brace structure that
// only the parser produces (see `names` in types.ts), so a hand-built fixture
// silently skips the code path that matters — which is how the corporate-author
// bug survived: `{{Centers for Disease Control and Prevention}}` cannot be
// expressed as a plain field string at all.
function entry(fields: Record<string, string>, type = "article"): BibEntry {
  const body = Object.entries(fields)
    .map(([k, v]) => `  ${k} = {${v}}`)
    .join(",\n");
  const parsed = parseBibtex(`@${type}{k,\n${body}\n}`);
  if (parsed.length !== 1) {
    throw new Error(`fixture did not parse to exactly one entry: ${parsed.length}`);
  }
  return parsed[0];
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

  // Regression: a brace-protected corporate author was split on its internal
  // " and ", so `{{Centers for Disease Control and Prevention}}` was sent as
  // first author "Control". Production returned mismatch/high, which the
  // extension renders as a red "Possible fabricated citation" — every CDC / WHO
  // / NICE entry falsely accused. Verified against /api/verify: the single
  // atomic author returns matched/high.
  it("keeps a brace-protected corporate author atomic", () => {
    const { claim } = buildClaim(
      entry({
        title: "Managing Acute Gastroenteritis Among Children",
        author: "{Centers for Disease Control and Prevention}",
        doi: "10.1542/peds.114.2.507",
      }),
    );
    expect(claim.authors).toEqual([{ family: "Centers for Disease Control and Prevention" }]);
  });

  it("still splits ordinary authors on ' and '", () => {
    const { claim } = buildClaim(
      entry({ title: "T", author: "Vaswani, Ashish and Shazeer, Noam", doi: "10.1/x" }),
    );
    expect(claim.authors).toEqual([
      { family: "Vaswani", given: "Ashish" },
      { family: "Shazeer", given: "Noam" },
    ]);
  });

  it("mixes a corporate author with personal ones", () => {
    const { claim } = buildClaim(
      entry({ title: "T", author: "{World Health Organization} and Smith, Jane", doi: "10.1/x" }),
    );
    expect(claim.authors).toEqual([
      { family: "World Health Organization" },
      { family: "Smith", given: "Jane" },
    ]);
  });

  // Regression: "others" is BibTeX's et-al sentinel, not a person. Sending it
  // made the server hunt for a co-author named "others" and downgrade the
  // verdict to `ambiguous` — reachable since ENABLE_COAUTHOR_CHECK went on in
  // prod on 2026-08-04.
  it("drops the 'others' et-al sentinel", () => {
    const { claim } = buildClaim(
      entry({ title: "T", author: "Smith, John and others", doi: "10.1/x" }),
    );
    expect(claim.authors).toEqual([{ family: "Smith", given: "John" }]);
  });

  // Regression: split(",", 2) read the suffix as the given name.
  it("handles the 3-part 'Last, Suffix, First' name form", () => {
    const { claim } = buildClaim(
      entry({ title: "T", author: "King, Jr., Martin Luther", doi: "10.1/x" }),
    );
    expect(claim.authors).toEqual([{ family: "King", given: "Martin Luther" }]);
  });
});
