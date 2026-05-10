import { describe, expect, it } from "vitest";
import {
  refreshSemanticIndexTool,
  semanticSearchTool,
} from "../src/core/tools/builtin/indexingTools";
import type { ToolContext, ToolIndexBridge, ToolSemanticHit } from "../src/core/tools/toolTypes";

function emptyCtx(index?: ToolIndexBridge): ToolContext {
  return {
    workspaceRoot: "/tmp/never",
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
    },
    security: {
      isIgnored: () => false,
      resolveWorkspacePath: (p) => p,
      scanSecrets: () => [],
    },
    checkpoints: {
      create: async () => ({ id: "cp", createdAt: Date.now(), files: [] }),
      restore: async () => 0,
      list: () => [],
    },
    flow: {
      setTodo: () => undefined,
      enqueue: () => ({ id: "q", createdAt: Date.now() }),
      recordSummary: () => undefined,
    },
    index,
  };
}

const stubBridgeBase: ToolIndexBridge = {
  refresh: async () => ({ files: 0, symbols: 0, uniqueTerms: 0, bytesIndexed: 0 }),
  stats: () => ({ files: 0, symbols: 0, uniqueTerms: 0, bytesIndexed: 0 }),
  findSymbol: () => [],
  lexicalSearch: () => [],
};

describe("semantic_search tool", () => {
  it("reports a clear error when the bridge does not implement semanticSearch", async () => {
    const r = await semanticSearchTool.execute({ query: "anything" }, emptyCtx(stubBridgeBase));
    expect(r.error).toMatch(/semantic search is not available/);
  });

  it("formats hits with file:line range, score, and snippet", async () => {
    const hits: ToolSemanticHit[] = [
      {
        filePath: "src/foo.ts",
        startLine: 10,
        endLine: 20,
        score: 0.91,
        snippet: "function foo() { return 1; }",
        symbolName: "foo",
        symbolKind: "function",
      },
      {
        filePath: "src/bar.ts",
        startLine: 1,
        endLine: 5,
        score: 0.42,
        snippet: "const x = 1;",
      },
    ];
    const bridge: ToolIndexBridge = {
      ...stubBridgeBase,
      semanticSearch: async () => hits,
    };
    const r = await semanticSearchTool.execute({ query: "foo" }, emptyCtx(bridge));
    expect(r.error).toBeUndefined();
    expect(r.content).toContain("src/foo.ts:10-20");
    expect(r.content).toContain("score=0.910");
    expect(r.content).toContain("(function foo)");
    expect(r.content).toContain("src/bar.ts:1-5");
    expect(r.data).toEqual(hits);
  });

  it("returns empty-result message when no hits", async () => {
    const bridge: ToolIndexBridge = { ...stubBridgeBase, semanticSearch: async () => [] };
    const r = await semanticSearchTool.execute({ query: "missing" }, emptyCtx(bridge));
    expect(r.content).toContain("no semantic matches");
  });
});

describe("refresh_semantic_index tool", () => {
  it("falls back to error when bridge has no refreshSemantic", async () => {
    const r = await refreshSemanticIndexTool.execute({}, emptyCtx(stubBridgeBase));
    expect(r.error).toMatch(/semantic index is not available/);
  });

  it("forwards the force flag and returns provider/model/dim summary", async () => {
    let receivedForce: boolean | undefined;
    const bridge: ToolIndexBridge = {
      ...stubBridgeBase,
      refreshSemantic: async (opts) => {
        receivedForce = opts?.force;
        return { files: 4, chunks: 12, providerId: "p", model: "m", dimensions: 768 };
      },
    };
    const r = await refreshSemanticIndexTool.execute({ force: true }, emptyCtx(bridge));
    expect(receivedForce).toBe(true);
    expect(r.content).toContain("4 files, 12 chunks");
    expect(r.content).toContain("(m, dim=768)");
  });
});
