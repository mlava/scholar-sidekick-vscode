// Parsed representation of a BibTeX entry, retaining source character offsets
// so diagnostics can be anchored to the exact lines in the document.

export interface BibEntry {
  /** Entry type, lowercased: "article", "book", "inproceedings", … */
  type: string;
  /** Citation key, e.g. "smith2020". Empty string if the entry had none. */
  key: string;
  /** Field name (lowercased) → unwrapped string value. */
  fields: Record<string, string>;
  /**
   * Name-list fields (`author`, `editor`) split into individual names.
   *
   * Split on " and " at brace depth 0 BEFORE braces are stripped, which is the
   * only thing that keeps a brace-protected corporate author intact:
   * `{{Centers for Disease Control and Prevention}}` is one name, not three.
   * `fields.author` has already lost that protection, so splitting it is unsafe.
   */
  names: Record<string, string[]>;
  /** Character offset of the leading "@" in the source. */
  start: number;
  /** Character offset just past the entry's closing "}". */
  end: number;
}
