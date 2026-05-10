import * as vscode from "vscode";
import type { HostToWebview } from "../../shared/protocol";
import type {
  DiagnosticInfo,
  EditorSelectionInfo,
  FileDiagnostics,
  SymbolInfo,
  ToolUiBridge,
} from "./toolTypes";

/**
 * Glue between the host VS Code APIs and the abstract `ToolUiBridge` consumed
 * by built-in tools. The adapter is tested via the bridge interface; the only
 * vscode-specific bits are this file and a few command invocations.
 */
export interface UiBridgeAdapterDeps {
  post: (m: HostToWebview) => void;
  showInputBox: (question: string) => Thenable<string | undefined>;
}

export function buildToolUiBridge(deps: UiBridgeAdapterDeps): ToolUiBridge {
  return {
    showInfo: (m) => deps.post({ type: "toast", level: "info", message: m }),
    showWarning: (m) => deps.post({ type: "toast", level: "warn", message: m }),
    showError: (m) => deps.post({ type: "toast", level: "error", message: m }),
    askUser: async (q) => await deps.showInputBox(q),
    getSelection: async () => extractActiveSelection(),
    getOpenFiles: async () =>
      vscode.workspace.textDocuments.map((d) => d.uri.fsPath),
    getDiagnostics: async (filePath) => collectDiagnostics(filePath),
    getSymbols: async (filePath) => extractSymbols(filePath),
  };
}

function extractActiveSelection(): EditorSelectionInfo | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return undefined;
  const sel = editor.selection;
  const file = editor.document.uri.fsPath;
  if (!sel || sel.isEmpty) {
    return {
      file,
      selection: {
        start: { line: sel?.start.line ?? 0, column: sel?.start.character ?? 0 },
        end: { line: sel?.end.line ?? 0, column: sel?.end.character ?? 0 },
      },
      text: "",
    };
  }
  return {
    file,
    selection: {
      start: { line: sel.start.line, column: sel.start.character },
      end: { line: sel.end.line, column: sel.end.character },
    },
    text: editor.document.getText(sel),
  };
}

function collectDiagnostics(filePath: string | undefined): FileDiagnostics[] {
  if (filePath) {
    const uri = vscode.Uri.file(filePath);
    const items = vscode.languages.getDiagnostics(uri).map(toDiagnosticInfo);
    return items.length === 0 ? [] : [{ file: filePath, items }];
  }
  const all = vscode.languages.getDiagnostics();
  const out: FileDiagnostics[] = [];
  for (const [uri, diags] of all) {
    if (diags.length === 0) continue;
    out.push({ file: uri.fsPath, items: diags.map(toDiagnosticInfo) });
  }
  return out;
}

function toDiagnosticInfo(d: vscode.Diagnostic): DiagnosticInfo {
  return {
    severity: severityFromVscode(d.severity),
    message: d.message,
    line: d.range.start.line + 1,
    column: d.range.start.character + 1,
    source: d.source,
    code:
      typeof d.code === "object" && d.code !== null
        ? String((d.code as { value: unknown }).value)
        : d.code !== undefined
          ? String(d.code)
          : undefined,
  };
}

function severityFromVscode(s: vscode.DiagnosticSeverity): DiagnosticInfo["severity"] {
  switch (s) {
    case vscode.DiagnosticSeverity.Error:
      return "error";
    case vscode.DiagnosticSeverity.Warning:
      return "warning";
    case vscode.DiagnosticSeverity.Information:
      return "info";
    case vscode.DiagnosticSeverity.Hint:
      return "hint";
    default:
      return "info";
  }
}

async function extractSymbols(filePath: string): Promise<SymbolInfo[]> {
  const uri = vscode.Uri.file(filePath);
  const raw = await vscode.commands.executeCommand<
    (vscode.DocumentSymbol | vscode.SymbolInformation)[] | undefined
  >("vscode.executeDocumentSymbolProvider", uri);
  if (!raw || raw.length === 0) return [];
  return raw.map(toSymbolInfo);
}

function toSymbolInfo(s: vscode.DocumentSymbol | vscode.SymbolInformation): SymbolInfo {
  if (isDocumentSymbol(s)) {
    return {
      name: s.name,
      kind: kindLabel(s.kind),
      line: s.range.start.line + 1,
      column: s.range.start.character + 1,
      detail: s.detail || undefined,
      children: s.children?.map(toSymbolInfo),
    };
  }
  return {
    name: s.name,
    kind: kindLabel(s.kind),
    line: s.location.range.start.line + 1,
    column: s.location.range.start.character + 1,
    container: s.containerName || undefined,
  };
}

function isDocumentSymbol(
  s: vscode.DocumentSymbol | vscode.SymbolInformation,
): s is vscode.DocumentSymbol {
  return Object.prototype.hasOwnProperty.call(s, "children");
}

function kindLabel(k: vscode.SymbolKind): string {
  // Mirror VS Code's enum names for stability across versions.
  return vscode.SymbolKind[k] ?? "Unknown";
}
