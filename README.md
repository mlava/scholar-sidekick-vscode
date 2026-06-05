# Scholar Sidekick — Citation Verifier for VS Code

Catch **fabricated, retracted, and out-of-date references in your `.bib` file —
before you submit.** Scholar Sidekick verifies every entry in your BibTeX
bibliography against the real scholarly record and flags problems inline, the
same way a linter flags bad code.

Built for people who write citation-bearing documents in VS Code (and forks like
Cursor, Windsurf, and Positron): **LaTeX** authors using LaTeX Workshop and
**Quarto** / R Markdown authors.

> This is **not** a citation _inserter_ — Quarto and Zotero already do that well.
> It's the safety net that checks the references you already have.

## What it does

For each entry in a `.bib` file it calls the
[Scholar Sidekick REST API](https://scholar-sidekick.com/docs) and surfaces:

| Signal | How it shows up |
| --- | --- |
| 🔴 **Possible fabrication** — the title doesn't match the work at the DOI/PMID/… (the [Topaz et al. 2026](https://doi.org/10.1016/S0140-6736(26)00603-3) pattern: a real identifier with an invented title) | Error squiggle + Problems panel |
| 🟠 **Retracted** / expression of concern (Crossref + Retraction Watch) | Warning squiggle |
| 🔵 **Unresolved / ambiguous** identifier | Info squiggle |
| 📂 **Open access** status + best legal URL (Unpaywall) | Hover card |
| ✅ **Verified** | Hover card + status-bar tally |

Hover any entry for the full verdict. The status bar shows a running tally:
`📖 ✓ 36  ✗ 1 fabricated?  ⚠ 2 retracted  ⊘ 4 unverifiable`.

**Honest coverage:** entries with no resolvable identifier (DOI/PMID/ISBN/arXiv/…)
are reported as _unverifiable_, never silently counted as clean.

## Usage

- Save a `.bib` file → it verifies automatically (toggle with
  `scholarSidekick.verifyOnSave`).
- Or run **Scholar Sidekick: Verify Bibliography** from the Command Palette.
- **Verify Bibliography (workspace)** sweeps every `.bib` in the project.

No account or API key is required — the free anonymous tier is used by default.
For higher rate limits, set `scholarSidekick.apiKey` to an `ssk_…` key from
[your account](https://scholar-sidekick.com/account).

## Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `scholarSidekick.apiBase` | `https://scholar-sidekick.com` | API base URL |
| `scholarSidekick.apiKey` | `""` | Optional `ssk_` bearer token |
| `scholarSidekick.verifyOnSave` | `true` | Verify on save |
| `scholarSidekick.checkRetraction` | `true` | Flag retractions |
| `scholarSidekick.checkOpenAccess` | `false` | Surface OA status |
| `scholarSidekick.maxConcurrency` | `4` | Parallel requests |

## Development

```bash
npm install
npm run compile      # or: npm run watch
# Press F5 in VS Code to launch an Extension Development Host
```

A sample bibliography for manual testing lives at
[`fixtures/sample.bib`](fixtures/sample.bib).

## License

MIT
