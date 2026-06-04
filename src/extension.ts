import * as vscode from "vscode";

import { parseBibtex } from "./bib/parse";
import { buildDiagnostics, buildHover } from "./diagnostics";
import {
  clearCache,
  runVerification,
  type EntryResult,
  type RunOptions,
} from "./verify/runner";

let diagnostics: vscode.DiagnosticCollection;
let statusBar: vscode.StatusBarItem;

// Per-document results, so the hover provider can look up by offset.
const resultsByDoc = new Map<string, EntryResult[]>();
// One in-flight run per document; re-running cancels the previous.
const inFlight = new Map<string, vscode.CancellationTokenSource>();

export function activate(context: vscode.ExtensionContext): void {
  diagnostics = vscode.languages.createDiagnosticCollection("scholarSidekick");
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = "scholarSidekick.verifyFile";
  context.subscriptions.push(diagnostics, statusBar);

  context.subscriptions.push(
    vscode.commands.registerCommand("scholarSidekick.verifyFile", () => {
      const editor = vscode.window.activeTextEditor;
      if (editor && isBib(editor.document)) {
        void verifyDocument(editor.document);
      } else {
        void vscode.window.showInformationMessage(
          "Open a .bib file to verify its citations.",
        );
      }
    }),
    vscode.commands.registerCommand("scholarSidekick.verifyWorkspace", () =>
      verifyWorkspace(),
    ),
    vscode.commands.registerCommand("scholarSidekick.clearDiagnostics", () => {
      diagnostics.clear();
      resultsByDoc.clear();
      clearCache();
      statusBar.hide();
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (isBib(doc) && config().verifyOnSave) {
        void verifyDocument(doc);
      }
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      diagnostics.delete(doc.uri);
      resultsByDoc.delete(doc.uri.toString());
    }),
  );

  context.subscriptions.push(
    vscode.languages.registerHoverProvider("bibtex", {
      provideHover(doc, position) {
        const results = resultsByDoc.get(doc.uri.toString());
        if (!results) {
          return undefined;
        }
        const offset = doc.offsetAt(position);
        const hit = results.find(
          (r) => offset >= r.entry.start && offset < r.entry.end,
        );
        return hit ? new vscode.Hover(buildHover(hit)) : undefined;
      },
    }),
  );

  // Verify any already-open .bib on activation.
  if (config().verifyOnSave) {
    for (const editor of vscode.window.visibleTextEditors) {
      if (isBib(editor.document)) {
        void verifyDocument(editor.document);
      }
    }
  }
}

export function deactivate(): void {
  for (const cts of inFlight.values()) {
    cts.cancel();
  }
  inFlight.clear();
}

function isBib(doc: vscode.TextDocument): boolean {
  return doc.languageId === "bibtex" || doc.fileName.endsWith(".bib");
}

interface Config extends RunOptions {
  verifyOnSave: boolean;
}

function config(): Config {
  const c = vscode.workspace.getConfiguration("scholarSidekick");
  return {
    apiBase: c.get<string>("apiBase", "https://scholar-sidekick.com"),
    apiKey: c.get<string>("apiKey", ""),
    verifyOnSave: c.get<boolean>("verifyOnSave", true),
    checkRetraction: c.get<boolean>("checkRetraction", true),
    checkOpenAccess: c.get<boolean>("checkOpenAccess", false),
    maxConcurrency: c.get<number>("maxConcurrency", 4),
  };
}

async function verifyDocument(doc: vscode.TextDocument): Promise<void> {
  const entries = parseBibtex(doc.getText());
  if (entries.length === 0) {
    diagnostics.delete(doc.uri);
    resultsByDoc.delete(doc.uri.toString());
    return;
  }

  // Cancel any previous run for this document.
  const key = doc.uri.toString();
  inFlight.get(key)?.cancel();
  const cts = new vscode.CancellationTokenSource();
  inFlight.set(key, cts);

  const cfg = config();

  try {
    const summary = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: `Scholar Sidekick: verifying ${entries.length} citations…`,
      },
      () =>
        runVerification(entries, {
          apiBase: cfg.apiBase,
          apiKey: cfg.apiKey,
          checkRetraction: cfg.checkRetraction,
          checkOpenAccess: cfg.checkOpenAccess,
          maxConcurrency: cfg.maxConcurrency,
          signal: toAbortSignal(cts.token),
        }),
    );

    if (cts.token.isCancellationRequested) {
      return;
    }

    resultsByDoc.set(key, summary.results);
    diagnostics.set(doc.uri, buildDiagnostics(doc, summary.results));
    updateStatusBar(summary.counts);

    if (summary.rateLimited) {
      void vscode.window.showWarningMessage(
        "Scholar Sidekick hit the rate limit — some entries were not verified. " +
          "Add an API key in settings or try again shortly.",
      );
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return; // superseded by a newer run
    }
    void vscode.window.showErrorMessage(
      `Scholar Sidekick verification failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  } finally {
    if (inFlight.get(key) === cts) {
      inFlight.delete(key);
    }
  }
}

async function verifyWorkspace(): Promise<void> {
  const uris = await vscode.workspace.findFiles("**/*.bib", "**/node_modules/**");
  if (uris.length === 0) {
    void vscode.window.showInformationMessage("No .bib files found in the workspace.");
    return;
  }
  for (const uri of uris) {
    const doc = await vscode.workspace.openTextDocument(uri);
    await verifyDocument(doc);
  }
}

function updateStatusBar(counts: {
  total: number;
  mismatch: number;
  retracted: number;
  openAccess: number;
  unverifiable: number;
  errors: number;
}): void {
  const parts: string[] = [`$(check) ${counts.total - counts.mismatch - counts.errors}`];
  if (counts.mismatch > 0) {
    parts.push(`$(error) ${counts.mismatch} fabricated?`);
  }
  if (counts.retracted > 0) {
    parts.push(`$(warning) ${counts.retracted} retracted`);
  }
  if (counts.unverifiable > 0) {
    parts.push(`$(circle-slash) ${counts.unverifiable} unverifiable`);
  }
  statusBar.text = `$(book) ${parts.join("  ")}`;
  statusBar.tooltip = buildStatusTooltip(counts);
  statusBar.show();
}

function buildStatusTooltip(counts: {
  total: number;
  mismatch: number;
  retracted: number;
  openAccess: number;
  unverifiable: number;
  errors: number;
}): string {
  return [
    `Scholar Sidekick — ${counts.total} entries`,
    `Possible fabrications: ${counts.mismatch}`,
    `Retracted: ${counts.retracted}`,
    `Open access: ${counts.openAccess}`,
    `Unverifiable (no identifier): ${counts.unverifiable}`,
    `Errors: ${counts.errors}`,
  ].join("\n");
}

/** Bridge a VS Code CancellationToken to a fetch AbortSignal. */
function toAbortSignal(token: vscode.CancellationToken): AbortSignal {
  const controller = new AbortController();
  if (token.isCancellationRequested) {
    controller.abort();
  } else {
    token.onCancellationRequested(() => controller.abort());
  }
  return controller.signal;
}
