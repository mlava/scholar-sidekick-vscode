// Turn verification results into VS Code diagnostics and hover cards.
//
// Diagnostics are deliberately conservative: we squiggle problems (fabrication,
// retraction, unresolved), not good news. Open-access and "matched" status are
// surfaced in the hover card and the status-bar summary instead of squiggling
// every healthy entry.

import * as vscode from "vscode";

import type { EntryResult } from "./verify/runner";

export const DIAGNOSTIC_SOURCE = "Scholar Sidekick";

/** Range covering the first line of an entry (the `@type{key,` head). */
function headRange(doc: vscode.TextDocument, result: EntryResult): vscode.Range {
  const startPos = doc.positionAt(result.entry.start);
  const lineEnd = doc.lineAt(startPos.line).range.end;
  return new vscode.Range(startPos, lineEnd);
}

export function buildDiagnostics(
  doc: vscode.TextDocument,
  results: EntryResult[],
): vscode.Diagnostic[] {
  const diagnostics: vscode.Diagnostic[] = [];

  for (const result of results) {
    const range = headRange(doc, result);

    // Retraction is the highest-signal problem — flag it even when the title
    // otherwise matches.
    if (result.retraction?.isRetracted) {
      diagnostics.push(
        diag(
          range,
          `This work appears to be retracted${noticeSuffix(result)}. Verify before citing.`,
          vscode.DiagnosticSeverity.Warning,
          "retracted",
        ),
      );
    } else if (result.retraction?.hasConcern) {
      diagnostics.push(
        diag(
          range,
          "An expression of concern has been raised about this work.",
          vscode.DiagnosticSeverity.Information,
          "expression-of-concern",
        ),
      );
    } else if (result.retraction?.hasCorrections) {
      diagnostics.push(
        diag(
          range,
          "A correction has been published for this work.",
          vscode.DiagnosticSeverity.Information,
          "correction",
        ),
      );
    }

    switch (result.status) {
      case "mismatch": {
        const resolved = result.verify?.matched?.title;
        const detail = resolved
          ? ` The identifier resolves to: “${resolved}”.`
          : "";
        diagnostics.push(
          diag(
            range,
            `Possible fabricated citation: the title does not match the work at this identifier.${detail}`,
            vscode.DiagnosticSeverity.Error,
            "fabrication-risk",
          ),
        );
        break;
      }
      case "not_found":
        diagnostics.push(
          diag(
            range,
            "This identifier could not be resolved to a real work.",
            vscode.DiagnosticSeverity.Warning,
            "not-found",
          ),
        );
        break;
      case "ambiguous":
        diagnostics.push(
          diag(
            range,
            "Verification was ambiguous — the work may exist under a different identifier. Review manually.",
            vscode.DiagnosticSeverity.Information,
            "ambiguous",
          ),
        );
        break;
      case "error":
        // Rate-limit errors are reported once at the window level, not per entry.
        if (result.errorMessage && !/rate limit/i.test(result.errorMessage)) {
          diagnostics.push(
            diag(
              range,
              `Could not verify this entry: ${result.errorMessage}`,
              vscode.DiagnosticSeverity.Information,
              "verify-error",
            ),
          );
        }
        break;
      default:
        break; // matched / unverifiable → no squiggle
    }
  }

  return diagnostics;
}

function noticeSuffix(result: EntryResult): string {
  const source = result.retraction?.notices?.find((n) => n.source)?.source;
  return source ? ` (${source})` : "";
}

function diag(
  range: vscode.Range,
  message: string,
  severity: vscode.DiagnosticSeverity,
  code: string,
): vscode.Diagnostic {
  const d = new vscode.Diagnostic(range, message, severity);
  d.source = DIAGNOSTIC_SOURCE;
  d.code = code;
  return d;
}

/** Markdown hover card summarising everything known about one entry. */
export function buildHover(result: EntryResult): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.isTrusted = false;
  md.supportHtml = false;

  const key = result.entry.key || "(no key)";
  md.appendMarkdown(`**Scholar Sidekick** · \`${key}\`\n\n`);

  switch (result.status) {
    case "matched":
      md.appendMarkdown(
        `✅ **Verified** — title matches the work at this identifier`,
      );
      if (result.verify?.confidence) {
        md.appendMarkdown(` (${result.verify.confidence} confidence)`);
      }
      md.appendMarkdown("\n\n");
      break;
    case "mismatch":
      md.appendMarkdown("❌ **Possible fabrication** — title does not match.\n\n");
      if (result.verify?.matched?.title) {
        md.appendMarkdown(`Resolved title: *${result.verify.matched.title}*\n\n`);
      }
      break;
    case "not_found":
      md.appendMarkdown("⚠️ **Not found** — identifier did not resolve.\n\n");
      break;
    case "ambiguous":
      md.appendMarkdown("❔ **Ambiguous** — review manually.\n\n");
      break;
    case "unverifiable":
      md.appendMarkdown(
        "➖ **Unverifiable** — no resolvable identifier (DOI/PMID/…) on this entry.\n\n",
      );
      break;
    case "error":
      md.appendMarkdown(`⚠️ Could not verify: ${result.errorMessage ?? "error"}\n\n`);
      break;
  }

  if (result.retraction?.isRetracted) {
    md.appendMarkdown(`🛑 **Retracted**${noticeSuffix(result)}\n\n`);
  } else if (result.retraction?.hasConcern) {
    md.appendMarkdown("⚠️ Expression of concern on record\n\n");
  } else if (result.retraction?.hasCorrections) {
    md.appendMarkdown("ℹ️ Correction published\n\n");
  }

  if (result.openAccess?.isOa) {
    const loc = result.openAccess.bestLocation;
    const url = loc?.url;
    md.appendMarkdown(
      `📂 **Open access** (${result.openAccess.oaStatus})` +
        (url ? ` — [best legal copy](${url})` : "") +
        "\n\n",
    );
  }

  return md;
}
