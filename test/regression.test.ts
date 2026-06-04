import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { buildClaim } from "../src/bib/claim";
import { parseBibtex } from "../src/bib/parse";
import type { BibEntry } from "../src/bib/types";

// Real-world entries that previously stressed the parser / claim builder.
// Loaded from a fixture so the cases read like the .bib a user would open.
const src = readFileSync(new URL("./fixtures/regression.bib", import.meta.url), "utf8");
const entries = parseBibtex(src);
const byKey = new Map<string, BibEntry>(entries.map((e) => [e.key, e]));

function claimFor(key: string) {
  const entry = byKey.get(key);
  if (!entry) {
    throw new Error(`fixture entry not found: ${key}`);
  }
  return buildClaim(entry);
}

describe("regression: real-world .bib entries", () => {
  it("parses every record and skips comments", () => {
    expect(entries.map((e) => e.key).sort()).toEqual(
      ["2019AA625A135L", "Barnes2000", "JacksonBest2018s1288901", "Posth2023s4158602"].sort(),
    );
  });

  describe("Posth2023 — 100+ authors with diacritics", () => {
    it("does not choke and extracts the DOI", () => {
      const { claim } = claimFor("Posth2023s4158602");
      expect(claim.doi).toBe("10.1038/s41586-023-05726-0");
      expect(claim.year).toBe(2023);
      expect(claim.container).toBe("Nature");
    });

    it("caps authors at 50 (the verify API limit)", () => {
      const { claim } = claimFor("Posth2023s4158602");
      expect(claim.authors?.length).toBe(50);
      // Diacritics survive the parse.
      expect(claim.authors?.[0]).toEqual({ family: "Posth", given: "C" });
    });
  });

  describe("Barnes2000 — ISBN book", () => {
    it("uses the ISBN as bestId and has no DOI", () => {
      const { claim, bestId, hasIdentifier } = claimFor("Barnes2000");
      expect(claim.isbn).toBe("9780192854087");
      expect(claim.doi).toBeUndefined();
      expect(bestId).toBe("9780192854087");
      expect(hasIdentifier).toBe(true);
    });
  });

  describe("Lallement A&A — DOI with bibcode in a note", () => {
    it("extracts the DOI but not the bibcode from note (known gap)", () => {
      const { claim } = claimFor("2019AA625A135L");
      expect(claim.doi).toBe("10.1051/0004-6361/201834695");
      expect(claim.ads).toBeUndefined();
    });

    it("keeps a digit-leading citation key intact", () => {
      expect(byKey.has("2019AA625A135L")).toBe(true);
    });
  });

  describe("Jackson-Best — doi field alongside a PubMed url", () => {
    it("takes the DOI from the doi field, not the URL", () => {
      const { claim } = claimFor("JacksonBest2018s1288901");
      expect(claim.doi).toBe("10.1186/s12889-018-5861-3");
      expect(claim.container).toBe("BMC public health");
    });
  });
});
