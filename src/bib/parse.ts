// A small, dependency-free BibTeX scanner.
//
// We hand-roll the parser (rather than pull in a heavyweight library) for two
// reasons: it keeps the extension a zero-runtime-dependency leaf, and — more
// importantly — it gives us exact character offsets for every entry, which we
// need to anchor diagnostics to the right lines in the document.
//
// It is deliberately lenient: real-world .bib files are messy. We tolerate
// @string/@preamble/@comment, nested braces, quoted values, and trailing
// commas, and we recover from a malformed entry by resuming at the next "@".

import type { BibEntry } from "./types";

const ENTRY_HEAD = /@([A-Za-z]+)\s*\{/g;

/** Entry types that are not bibliography records and carry nothing to verify. */
const NON_RECORD_TYPES = new Set(["string", "preamble", "comment"]);

export function parseBibtex(text: string): BibEntry[] {
  const entries: BibEntry[] = [];
  ENTRY_HEAD.lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = ENTRY_HEAD.exec(text)) !== null) {
    const type = m[1].toLowerCase();
    const start = m.index;
    const bodyStart = ENTRY_HEAD.lastIndex; // just past the opening "{"

    const bodyEnd = findMatchingBrace(text, bodyStart - 1);
    if (bodyEnd === -1) {
      // Unbalanced braces — stop scanning; the rest is unparseable.
      break;
    }

    // Resume the outer scan just past this entry regardless of outcome.
    ENTRY_HEAD.lastIndex = bodyEnd + 1;

    if (NON_RECORD_TYPES.has(type)) {
      continue;
    }

    const body = text.slice(bodyStart, bodyEnd);
    const { key, fields } = parseBody(body);
    entries.push({ type, key, fields, start, end: bodyEnd + 1 });
  }

  return entries;
}

/** Returns the index of the "}" that closes the "{" at `open`, or -1. */
function findMatchingBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

interface ParsedBody {
  key: string;
  fields: Record<string, string>;
}

function parseBody(body: string): ParsedBody {
  // The citation key runs from the start to the first top-level comma.
  const firstComma = indexOfTopLevelComma(body, 0);
  if (firstComma === -1) {
    return { key: body.trim(), fields: {} };
  }
  const key = body.slice(0, firstComma).trim();
  const fields: Record<string, string> = {};

  let i = firstComma + 1;
  while (i < body.length) {
    // Skip whitespace/commas between fields.
    while (i < body.length && /[\s,]/.test(body[i])) {
      i++;
    }
    if (i >= body.length) {
      break;
    }

    const eq = body.indexOf("=", i);
    if (eq === -1) {
      break;
    }
    const name = body.slice(i, eq).trim().toLowerCase();

    const { value, next } = readValue(body, eq + 1);
    if (name) {
      fields[name] = value;
    }
    i = next;
  }

  return { key, fields };
}

/** Find the next comma at brace-depth 0 (ignoring braces and quotes). */
function indexOfTopLevelComma(s: string, from: number): number {
  let depth = 0;
  let inQuote = false;
  for (let i = from; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"' && depth === 0) {
      inQuote = !inQuote;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
    } else if (ch === "," && depth === 0 && !inQuote) {
      return i;
    }
  }
  return -1;
}

interface ReadValue {
  value: string;
  next: number;
}

/** Read a field value starting at `from`, returning the unwrapped string. */
function readValue(s: string, from: number): ReadValue {
  let i = from;
  while (i < s.length && /\s/.test(s[i])) {
    i++;
  }
  if (i >= s.length) {
    return { value: "", next: i };
  }

  const ch = s[i];

  if (ch === "{") {
    const close = findMatchingBrace(s, i);
    if (close === -1) {
      return { value: cleanup(s.slice(i + 1)), next: s.length };
    }
    return { value: cleanup(s.slice(i + 1, close)), next: close + 1 };
  }

  if (ch === '"') {
    // Quoted value; allow braces inside but the closing quote ends it.
    let depth = 0;
    for (let j = i + 1; j < s.length; j++) {
      const c = s[j];
      if (c === "{") {
        depth++;
      } else if (c === "}") {
        depth--;
      } else if (c === '"' && depth === 0) {
        return { value: cleanup(s.slice(i + 1, j)), next: j + 1 };
      }
    }
    return { value: cleanup(s.slice(i + 1)), next: s.length };
  }

  // Bare value (number or @string macro) — runs to the next top-level comma.
  const comma = indexOfTopLevelComma(s, i);
  const end = comma === -1 ? s.length : comma;
  return { value: cleanup(s.slice(i, end)), next: end };
}

/** Collapse whitespace and strip stray braces left from nested groups. */
function cleanup(raw: string): string {
  return raw
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
