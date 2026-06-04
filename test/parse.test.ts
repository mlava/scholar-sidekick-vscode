import { describe, expect, it } from "vitest";

import { parseBibtex } from "../src/bib/parse";

describe("parseBibtex", () => {
  it("parses a basic entry and records offsets", () => {
    const src = `@article{key1,\n  title = {Hello},\n  year = {2020}\n}`;
    const [entry] = parseBibtex(src);
    expect(entry.type).toBe("article");
    expect(entry.key).toBe("key1");
    expect(entry.fields.title).toBe("Hello");
    expect(entry.fields.year).toBe("2020");
    expect(src.slice(entry.start, entry.end)).toBe(src);
  });

  it("skips @string, @preamble, and @comment", () => {
    const src = `@string{ieee = "IEEE"}\n@comment{ignore me}\n@article{a, title={T}, doi={10.1/x}}`;
    const entries = parseBibtex(src);
    expect(entries).toHaveLength(1);
    expect(entries[0].key).toBe("a");
  });

  it("handles quoted, braced, and bare values", () => {
    const src = `@article{a, title = "Quoted", journal = {Braced}, year = 1999}`;
    const [entry] = parseBibtex(src);
    expect(entry.fields.title).toBe("Quoted");
    expect(entry.fields.journal).toBe("Braced");
    expect(entry.fields.year).toBe("1999");
  });

  it("handles nested braces in a value", () => {
    const src = `@article{a, title = {A {Nested} Title}, doi={10.1/x}}`;
    const [entry] = parseBibtex(src);
    expect(entry.fields.title).toBe("A Nested Title");
  });

  it("tolerates a trailing comma after the last field", () => {
    const src = `@article{a, title={T}, year={2020},}`;
    const [entry] = parseBibtex(src);
    expect(entry.fields.title).toBe("T");
    expect(entry.fields.year).toBe("2020");
  });

  it("lowercases entry type and field names", () => {
    const src = `@Article{a, Title={T}, DOI={10.1/x}}`;
    const [entry] = parseBibtex(src);
    expect(entry.type).toBe("article");
    expect(entry.fields.title).toBe("T");
    expect(entry.fields.doi).toBe("10.1/x");
  });

  it("parses multiple entries with correct, non-overlapping offsets", () => {
    const src = `@article{a, title={A}}\n\n@book{b, title={B}}`;
    const entries = parseBibtex(src);
    expect(entries.map((e) => e.key)).toEqual(["a", "b"]);
    expect(entries[0].end).toBeLessThanOrEqual(entries[1].start);
  });

  it("returns no entries for prose with no @ records", () => {
    expect(parseBibtex("just some text {with braces}")).toEqual([]);
  });
});
