import { z } from "zod";
import type {
  DiagnosticInfo,
  FileDiagnostics,
  SymbolInfo,
  ToolDefinition,
} from "../toolTypes";
import { getRecentTerminalOutputs } from "./terminalCapture";

const MAX_OPEN_FILES = 50;
const MAX_DIAGNOSTICS_PER_FILE = 200;
const MAX_SYMBOLS = 500;
const MAX_TERMINAL_BYTES = 32 * 1024;

const SEVERITY_LABEL: Record<DiagnosticInfo["severity"], string> = {
  error: "ERROR",
  warning: "WARN",
  info: "INFO",
  hint: "HINT",
};

export const getOpenFilesTool: ToolDefinition<Record<string, never>> = {
  id: "get_open_files",
  name: "get_open_files",
  description:
    "Returns a list of files currently open in the editor (workspace-relative or absolute paths).",
  category: "read",
  riskLevel: "safe",
  schema: z.object({}).strict(),
  parameters: { type: "object", properties: {}, additionalProperties: false },
  async execute(_args, ctx) {
    const files = await ctx.ui.getOpenFiles();
    const filtered = files.filter((p) => !ctx.security.isIgnored(p));
    const trimmed = filtered.slice(0, MAX_OPEN_FILES);
    return {
      content: trimmed.length === 0 ? "(no open editors)" : trimmed.join("\n"),
      data: trimmed,
    };
  },
};

export const getSelectionTool: ToolDefinition<Record<string, never>> = {
  id: "get_selection",
  name: "get_selection",
  description:
    "Returns the active editor's selection (file path, range, and selected text). Returns 'none' when no editor is focused.",
  category: "read",
  riskLevel: "safe",
  schema: z.object({}).strict(),
  parameters: { type: "object", properties: {}, additionalProperties: false },
  async execute(_args, ctx) {
    const sel = await ctx.ui.getSelection();
    if (!sel) return { content: "(no active editor)", data: undefined };
    const range = sel.selection
      ? `${sel.selection.start.line + 1}:${sel.selection.start.column + 1}-${sel.selection.end.line + 1}:${sel.selection.end.column + 1}`
      : "(empty)";
    const redactedText = sel.text ? ctx.security.scanSecrets(sel.text).redacted : "";
    const content = sel.text
      ? `${sel.file} ${range}\n---\n${redactedText}`
      : `${sel.file} ${range}\n(no characters selected)`;
    return { content, data: { ...sel, text: redactedText } };
  },
};

export const getDiagnosticsTool: ToolDefinition<{ path?: string; severity?: DiagnosticInfo["severity"] }> = {
  id: "get_diagnostics",
  name: "get_diagnostics",
  description:
    "Returns workspace problems (errors, warnings, hints) reported by VS Code language servers. Optionally filter by file path or minimum severity.",
  category: "diagnostics",
  riskLevel: "safe",
  schema: z.object({
    path: z.string().optional(),
    severity: z.enum(["error", "warning", "info", "hint"]).optional(),
  }),
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Workspace-relative or absolute path. Omit for the whole workspace." },
      severity: {
        type: "string",
        enum: ["error", "warning", "info", "hint"],
        description: "Minimum severity to include (defaults to 'hint', i.e. all).",
      },
    },
  },
  async execute(args, ctx) {
    const target = args.path ? ctx.security.resolveWorkspacePath(args.path) : undefined;
    if (target && ctx.security.isIgnored(target)) {
      return { content: "", error: `path "${args.path}" is ignored by .nexusignore` };
    }
    const all = await ctx.ui.getDiagnostics(target);
    const minRank = severityRank(args.severity ?? "hint");
    const filtered: FileDiagnostics[] = all
      .map((entry) => ({
        file: entry.file,
        items: entry.items
          .filter((d) => severityRank(d.severity) <= minRank)
          .slice(0, MAX_DIAGNOSTICS_PER_FILE),
      }))
      .filter((entry) => entry.items.length > 0);

    if (filtered.length === 0) {
      return { content: "(no diagnostics)", data: filtered };
    }
    const lines: string[] = [];
    for (const entry of filtered) {
      for (const d of entry.items) {
        const code = d.code ? ` [${d.code}]` : "";
        const src = d.source ? ` (${d.source})` : "";
        lines.push(
          `${entry.file}:${d.line}:${d.column}: ${SEVERITY_LABEL[d.severity]}${src}${code} ${d.message}`,
        );
      }
    }
    return { content: lines.join("\n"), data: filtered };
  },
};

export const getSymbolsTool: ToolDefinition<{ path: string; query?: string }> = {
  id: "get_symbols",
  name: "get_symbols",
  description:
    "Returns the document symbol tree for a file (functions, classes, methods, etc.) via the editor's language service.",
  category: "read",
  riskLevel: "safe",
  schema: z.object({
    path: z.string(),
    query: z.string().optional(),
  }),
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Workspace-relative or absolute path of the file." },
      query: { type: "string", description: "Optional case-insensitive name substring filter." },
    },
    required: ["path"],
  },
  async execute(args, ctx) {
    const abs = ctx.security.resolveWorkspacePath(args.path);
    if (ctx.security.isIgnored(abs)) {
      return { content: "", error: `path "${args.path}" is ignored by .nexusignore` };
    }
    const symbols = await ctx.ui.getSymbols(abs);
    const flat = flattenSymbols(symbols);
    const needle = args.query?.toLowerCase();
    const filtered = needle
      ? flat.filter((s) => s.name.toLowerCase().includes(needle))
      : flat;
    const trimmed = filtered.slice(0, MAX_SYMBOLS);
    if (trimmed.length === 0) return { content: "(no symbols)", data: [] };
    const lines = trimmed.map((s) => {
      const container = s.container ? ` in ${s.container}` : "";
      const detail = s.detail ? ` — ${s.detail}` : "";
      return `${s.line}:${s.column} ${s.kind} ${s.name}${container}${detail}`;
    });
    return { content: lines.join("\n"), data: trimmed };
  },
};

export const getTerminalOutputTool: ToolDefinition<{ entries?: number }> = {
  id: "get_terminal_output",
  name: "get_terminal_output",
  description:
    "Returns the most recent stdout/stderr captured from `run_terminal_command` invocations (newest first). Use to inspect output from a previous step without re-running.",
  category: "read",
  riskLevel: "safe",
  schema: z.object({ entries: z.number().int().min(1).max(16).optional() }),
  parameters: {
    type: "object",
    properties: {
      entries: {
        type: "integer",
        description: "How many recent invocations to return (default 1, max 16).",
      },
    },
  },
  async execute(args) {
    const recents = getRecentTerminalOutputs(args.entries ?? 1);
    if (recents.length === 0) {
      return { content: "(no terminal history yet)", data: [] };
    }
    const sections = recents.map((snap) => {
      const header = `$ ${snap.command} (exit ${snap.exitCode ?? "?"}${snap.signal ? `, signal ${snap.signal}` : ""})`;
      const stdout = trimToBytes(snap.stdout, MAX_TERMINAL_BYTES);
      const stderr = trimToBytes(snap.stderr, MAX_TERMINAL_BYTES);
      const body =
        (stdout ? `stdout:\n${stdout}\n` : "") + (stderr ? `stderr:\n${stderr}\n` : "");
      return body ? `${header}\n${body.trimEnd()}` : header;
    });
    return { content: sections.join("\n\n"), data: recents };
  },
};

function severityRank(s: DiagnosticInfo["severity"]): number {
  switch (s) {
    case "error":
      return 0;
    case "warning":
      return 1;
    case "info":
      return 2;
    case "hint":
      return 3;
  }
}

function flattenSymbols(syms: SymbolInfo[], container?: string): SymbolInfo[] {
  const out: SymbolInfo[] = [];
  for (const s of syms) {
    out.push({ ...s, container, children: undefined });
    if (s.children && s.children.length > 0) {
      const inner = container ? `${container}.${s.name}` : s.name;
      out.push(...flattenSymbols(s.children, inner));
    }
  }
  return out;
}

function trimToBytes(s: string, maxBytes: number): string {
  if (s.length <= maxBytes) return s;
  return `(truncated)\n${s.slice(-maxBytes)}`;
}
