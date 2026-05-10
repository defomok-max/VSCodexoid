import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getDiagnosticsTool,
  getOpenFilesTool,
  getSelectionTool,
  getSymbolsTool,
  getTerminalOutputTool,
} from "../src/core/tools/builtin/workspaceTools";
import {
  clearTerminalCapture,
  recordTerminalOutput,
} from "../src/core/tools/builtin/terminalCapture";
import { scanSecrets } from "../src/core/security/secretScanner";
import type {
  FileDiagnostics,
  SymbolInfo,
  ToolContext,
  ToolUiBridge,
} from "../src/core/tools/toolTypes";

interface BuildCtxOpts {
  ui?: Partial<ToolUiBridge>;
  ignored?: Set<string>;
}

function buildCtx(opts: BuildCtxOpts = {}): ToolContext {
  const ignored = opts.ignored ?? new Set<string>();
  return {
    workspaceRoot: "/ws",
    signal: new AbortController().signal,
    log: () => undefined,
    ui: {
      showInfo: () => undefined,
      showWarning: () => undefined,
      showError: () => undefined,
      getSelection: async () => undefined,
      getOpenFiles: async () => [],
      getDiagnostics: async () => [],
      getSymbols: async () => [],
      askUser: async () => undefined,
      ...opts.ui,
    },
    security: {
      isIgnored: (p) => ignored.has(p),
      resolveWorkspacePath: (p) => (p.startsWith("/") ? p : `/ws/${p}`),
      scanSecrets: (s) => scanSecrets(s),
    },
    checkpoints: {
      create: async () => ({ id: "cp_test", createdAt: Date.now(), files: [] }),
      restore: async () => 0,
      list: () => [],
    },
  };
}

describe("get_open_files", () => {
  it("returns the bridge list and filters ignored files", async () => {
    const ctx = buildCtx({
      ui: { getOpenFiles: async () => ["/ws/a.ts", "/ws/secrets.env"] },
      ignored: new Set(["/ws/secrets.env"]),
    });
    const r = await getOpenFilesTool.execute({}, ctx);
    expect(r.content).toBe("/ws/a.ts");
    expect(r.data).toEqual(["/ws/a.ts"]);
  });

  it("reports an empty editor list", async () => {
    const ctx = buildCtx();
    const r = await getOpenFilesTool.execute({}, ctx);
    expect(r.content).toBe("(no open editors)");
  });
});

describe("get_selection", () => {
  it("returns 'no active editor' when bridge yields undefined", async () => {
    const ctx = buildCtx();
    const r = await getSelectionTool.execute({}, ctx);
    expect(r.content).toBe("(no active editor)");
  });

  it("formats range and redacts secrets in selected text", async () => {
    const ctx = buildCtx({
      ui: {
        getSelection: async () => ({
          file: "/ws/a.ts",
          selection: {
            start: { line: 0, column: 0 },
            end: { line: 0, column: 60 },
          },
          text: "key=sk-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH",
        }),
      },
    });
    const r = await getSelectionTool.execute({}, ctx);
    expect(r.content).toContain("/ws/a.ts 1:1-1:61");
    expect(r.content).toContain("[REDACTED:openai]");
    expect(r.content).not.toContain("sk-abcdefgh");
  });

  it("indicates an empty selection range", async () => {
    const ctx = buildCtx({
      ui: {
        getSelection: async () => ({
          file: "/ws/a.ts",
          selection: {
            start: { line: 4, column: 2 },
            end: { line: 4, column: 2 },
          },
          text: "",
        }),
      },
    });
    const r = await getSelectionTool.execute({}, ctx);
    expect(r.content).toContain("/ws/a.ts 5:3-5:3");
    expect(r.content).toContain("(no characters selected)");
  });
});

describe("get_diagnostics", () => {
  const sample: FileDiagnostics[] = [
    {
      file: "/ws/a.ts",
      items: [
        {
          severity: "error",
          message: "missing semicolon",
          line: 10,
          column: 4,
          source: "ts",
          code: "1005",
        },
        {
          severity: "warning",
          message: "unused var",
          line: 12,
          column: 2,
          source: "ts",
          code: "6133",
        },
      ],
    },
    {
      file: "/ws/b.ts",
      items: [{ severity: "hint", message: "prefer const", line: 1, column: 1 }],
    },
  ];

  it("formats diagnostics newest-severity first", async () => {
    const ctx = buildCtx({ ui: { getDiagnostics: async () => sample } });
    const r = await getDiagnosticsTool.execute({}, ctx);
    expect(r.content).toContain("/ws/a.ts:10:4: ERROR (ts) [1005] missing semicolon");
    expect(r.content).toContain("/ws/a.ts:12:2: WARN (ts) [6133] unused var");
    expect(r.content).toContain("/ws/b.ts:1:1: HINT prefer const");
  });

  it("filters by minimum severity", async () => {
    const ctx = buildCtx({ ui: { getDiagnostics: async () => sample } });
    const r = await getDiagnosticsTool.execute({ severity: "warning" }, ctx);
    expect(r.content).toContain("ERROR");
    expect(r.content).toContain("WARN");
    expect(r.content).not.toContain("HINT");
  });

  it("refuses paths blocked by .nexusignore", async () => {
    const ctx = buildCtx({ ignored: new Set(["/ws/secret"]) });
    const r = await getDiagnosticsTool.execute({ path: "secret" }, ctx);
    expect(r.error).toMatch(/ignored/);
  });

  it("reports an empty result when nothing matches", async () => {
    const ctx = buildCtx({ ui: { getDiagnostics: async () => [] } });
    const r = await getDiagnosticsTool.execute({}, ctx);
    expect(r.content).toBe("(no diagnostics)");
  });
});

describe("get_symbols", () => {
  const tree: SymbolInfo[] = [
    {
      name: "Foo",
      kind: "Class",
      line: 1,
      column: 1,
      children: [
        { name: "bar", kind: "Method", line: 2, column: 3 },
        { name: "baz", kind: "Method", line: 5, column: 3 },
      ],
    },
    { name: "helper", kind: "Function", line: 20, column: 1 },
  ];

  it("flattens nested symbols and records the container chain", async () => {
    const ctx = buildCtx({ ui: { getSymbols: async () => tree } });
    const r = await getSymbolsTool.execute({ path: "/ws/a.ts" }, ctx);
    expect(r.content).toContain("1:1 Class Foo");
    expect(r.content).toContain("2:3 Method bar in Foo");
    expect(r.content).toContain("5:3 Method baz in Foo");
    expect(r.content).toContain("20:1 Function helper");
  });

  it("filters by case-insensitive name query", async () => {
    const ctx = buildCtx({ ui: { getSymbols: async () => tree } });
    const r = await getSymbolsTool.execute({ path: "/ws/a.ts", query: "BAR" }, ctx);
    expect(r.content).toContain("Method bar in Foo");
    expect(r.content).not.toContain("helper");
  });

  it("refuses ignored paths", async () => {
    const ctx = buildCtx({ ignored: new Set(["/ws/secret.ts"]) });
    const r = await getSymbolsTool.execute({ path: "secret.ts" }, ctx);
    expect(r.error).toMatch(/ignored/);
  });
});

describe("get_terminal_output", () => {
  beforeEach(() => clearTerminalCapture());
  afterEach(() => clearTerminalCapture());

  it("reports empty history when nothing has run", async () => {
    const ctx = buildCtx();
    const r = await getTerminalOutputTool.execute({}, ctx);
    expect(r.content).toBe("(no terminal history yet)");
  });

  it("returns the most recent invocations newest-first", async () => {
    recordTerminalOutput({
      command: "echo first",
      cwd: "/ws",
      stdout: "first\n",
      stderr: "",
      exitCode: 0,
      signal: null,
      ts: 1,
    });
    recordTerminalOutput({
      command: "echo second",
      cwd: "/ws",
      stdout: "second\n",
      stderr: "warn\n",
      exitCode: 1,
      signal: null,
      ts: 2,
    });
    const ctx = buildCtx();
    const r = await getTerminalOutputTool.execute({ entries: 2 }, ctx);
    const idxFirst = r.content.indexOf("$ echo first");
    const idxSecond = r.content.indexOf("$ echo second");
    expect(idxSecond).toBeGreaterThanOrEqual(0);
    expect(idxFirst).toBeGreaterThan(idxSecond);
    expect(r.content).toContain("(exit 1)");
    expect(r.content).toContain("stderr:\nwarn");
  });
});
