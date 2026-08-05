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
    const { key, fields, names } = parseBody(body);
    entries.push({ type, key, fields, names, start, end: bodyEnd + 1 });
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
  names: Record<string, string[]>;
}

function parseBody(body: string): ParsedBody {
  // The citation key runs from the start to the first top-level comma.
  const firstComma = indexOfTopLevelComma(body, 0);
  if (firstComma === -1) {
    return { key: body.trim(), fields: {}, names: {} };
  }
  const key = body.slice(0, firstComma).trim();
  const fields: Record<string, string> = {};
  const names: Record<string, string[]> = {};

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

    const { value, raw, next } = readValue(body, eq + 1);
    if (name) {
      fields[name] = value;
      if (NAME_FIELDS.has(name)) {
        names[name] = splitNameList(raw);
      }
    }
    i = next;
  }

  return { key, fields, names };
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
  /** The value before `cleanup()` stripped braces. */
  raw: string;
  next: number;
}

/** Read a field value starting at `from`, returning the unwrapped string. */
function readValue(s: string, from: number): ReadValue {
  let i = from;
  while (i < s.length && /\s/.test(s[i])) {
    i++;
  }
  if (i >= s.length) {
    return { value: "", raw: "", next: i };
  }

  const ch = s[i];

  if (ch === "{") {
    const close = findMatchingBrace(s, i);
    if (close === -1) {
      return wrap(s.slice(i + 1), s.length);
    }
    return wrap(s.slice(i + 1, close), close + 1);
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
        return wrap(s.slice(i + 1, j), j + 1);
      }
    }
    return wrap(s.slice(i + 1), s.length);
  }

  // Bare value (number or @string macro) — runs to the next top-level comma.
  const comma = indexOfTopLevelComma(s, i);
  const end = comma === -1 ? s.length : comma;
  return wrap(s.slice(i, end), end);
}

/** Carry the raw slice alongside the cleaned value; name-list splitting needs the braces. */
function wrap(raw: string, next: number): ReadValue {
  return { value: cleanup(raw), raw, next };
}

/** Collapse whitespace and strip stray braces left from nested groups. */
function cleanup(raw: string): string {
  return raw
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** BibTeX name-list fields, where " and " separates names rather than reading as prose. */
const NAME_FIELDS = new Set(["author", "editor"]);

/**
 * Split a BibTeX name list on " and " occurring at brace depth 0.
 *
 * Must run on the RAW value, before `cleanup()` strips braces. Double-bracing is
 * the only way BibTeX marks a corporate name as a single unit, so
 * `{{Centers for Disease Control and Prevention}}` is one author; splitting the
 * brace-stripped string instead yields "Centers for Disease Control" +
 * "Prevention" and gets the entry reported as a fabricated citation.
 */
function splitNameList(raw: string): string[] {
  const names: string[] = [];
  let depth = 0;
  let start = 0;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === "{") {
      depth++;
      continue;
    }
    if (ch === "}") {
      depth--;
      continue;
    }
    if (depth !== 0 || !/\s/.test(ch)) {
      continue;
    }
    const sep = /^\s+and\s+/i.exec(raw.slice(i));
    if (sep) {
      names.push(raw.slice(start, i));
      i += sep[0].length - 1;
      start = i + 1;
    }
  }
  names.push(raw.slice(start));

  // A segment that is entirely brace-wrapped is a protected (corporate) name and
  // must stay atomic — "Centers for Disease Control and Prevention" is one
  // organisation, not a given name plus the family name "Prevention". Keep the
  // wrapping braces so the claim builder can tell the two cases apart; it strips
  // them. Everything else is cleaned as usual.
  return names
    .map((name) => {
      const trimmed = name.trim();
      const wrapped =
        trimmed.startsWith("{") &&
        trimmed.endsWith("}") &&
        findMatchingBrace(trimmed, 0) === trimmed.length - 1;
      return wrapped ? `{${cleanup(trimmed.slice(1, -1))}}` : cleanup(trimmed);
    })
    .filter((name) => name && name !== "{}");
}
