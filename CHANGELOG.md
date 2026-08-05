# Changelog

## 0.1.2 — 2026-08-05

### Fixed

- **Corporate authors are no longer reported as fabricated citations.** A
  brace-protected organisation name was split on its own internal " and ", so
  `author = {{Centers for Disease Control and Prevention}}` was sent as first
  author "Control" and came back as a `mismatch` — rendered as a red "Possible
  fabricated citation". Every WHO / CDC / NICE / GBD-style entry in a
  bibliography was affected. Such entries now verify correctly.
- **`and others` no longer triggers a false "ambiguous" verdict.** BibTeX's
  et-al sentinel was being sent as a claimed co-author literally named "others",
  which the server could not find on the resolved record.
- **Three-part names keep their given name.** `King, Jr., Martin Luther` read the
  suffix as the given name and dropped "Martin Luther".
- **Diagnostics now say which field disagreed.** The extension received the
  server's per-field comparison but never displayed it, so an ambiguous result
  always read "the work may exist under a different identifier" — wrong whenever
  the identifier had resolved perfectly. Hovers now include a claimed-vs-resolved
  table.

### Security

- `scholarSidekick.apiKey` and `scholarSidekick.apiBase` are now machine-scoped.
  They previously defaulted to window scope, so a checked-in
  `.vscode/settings.json` could repoint the API base and — with `verifyOnSave` on
  by default — send your API key to another host when you opened a cloned repo's
  `.bib`.

## 0.1.1 — 2026-08-04

- Requests carry an `X-Scholar-Client` handshake header so calls attribute
  correctly to the extension.
- README corrections; CI now runs lint and a cross-repo endpoint-contract check.

## 0.1.0 — 2026-06-04

- Initial release: inline `.bib` linting for fabricated citations, retractions,
  and open-access status.
