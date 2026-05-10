import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  askUserTool,
  queueMessageTool,
  showDiffTool,
  summarizeSessionTool,
  updateTodoListTool,
} from "../src/core/tools/builtin/flowTools";
import { IgnoreMatcher, SAFE_DEFAULT_IGNORES } from "../src/core/security/ignoreMatcher";
import { scanSecrets } from "../src/core/security/secretScanner";
import { resolveWorkspacePath } from "../src/core/security/pathGuard";
import type { ToolContext, ToolQueueItemInput, ToolTodoItem } from "../src/core/tools/toolTypes";

interface FlowSpy {
  todos: { taskId: string; items: ToolTodoItem[] }[];
  queued: ToolQueueItemInput[];
  summaries: { taskId: string; summary: string }[];
}

function buildCtx(opts: {
  root?: string;
  ask?: (q: string) => Promise<string | undefined>;
  taskId?: string | undefined;
  spy?: FlowSpy;
} = {}): { ctx: ToolContext; spy: FlowSpy } {
  const root = opts.root ?? "/ws";
  const matcher = new IgnoreMatcher(root);
  matcher.addPatterns(SAFE_DEFAULT_IGNORES.join("\n"));
  const spy: FlowSpy = opts.spy ?? { todos: [], queued: [], summaries: [] };
  const ctx: ToolContext = {
    workspaceRoot: root,
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
      askUser: opts.ask ?? (async () => undefined),
    },
    security: {
      isIgnored: (p) => matcher.isIgnored(p),
      resolveWorkspacePath: (p) => resolveWorkspacePath(root, p),
      scanSecrets: (s) => scanSecrets(s),
    },
    checkpoints: {
      create: async () => ({ id: "cp_test", createdAt: Date.now(), files: [] }),
      restore: async () => 0,
      list: () => [],
    },
    flow: {
      setTodo: (taskId, items) => {
        spy.todos.push({ taskId, items });
      },
      enqueue: (item) => {
        spy.queued.push(item);
        return { id: `q${spy.queued.length}`, createdAt: Date.now() };
      },
      recordSummary: (taskId, summary) => {
        spy.summaries.push({ taskId, summary });
      },
    },
    taskId: opts.taskId,
  };
  return { ctx, spy };
}

describe("ask_user", () => {
  it("returns the user's answer", async () => {
    const { ctx } = buildCtx({ ask: async (q) => `re: ${q}` });
    const r = await askUserTool.execute({ question: "ok?" }, ctx);
    expect(r.error).toBeUndefined();
    expect(r.content).toBe("re: ok?");
  });

  it("flags cancellation when the user dismisses", async () => {
    const { ctx } = buildCtx({ ask: async () => undefined });
    const r = await askUserTool.execute({ question: "?" }, ctx);
    expect(r.cancelled).toBe(true);
  });
});

describe("show_diff", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "nx-flow-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("returns a ToolDiff for inline before/after", async () => {
    const { ctx } = buildCtx({ root: dir });
    const r = await showDiffTool.execute(
      { path: "src/foo.ts", before: "old\n", after: "new\n" },
      ctx,
    );
    expect(r.error).toBeUndefined();
    expect(r.diff?.files[0]).toEqual({ path: "src/foo.ts", before: "old\n", after: "new\n" });
  });

  it("reads beforePath from disk", async () => {
    fs.writeFileSync(path.join(dir, "a.txt"), "v1\n");
    const { ctx } = buildCtx({ root: dir });
    const r = await showDiffTool.execute(
      { path: "a.txt", beforePath: "a.txt", after: "v2\n" },
      ctx,
    );
    expect(r.diff?.files[0].before).toBe("v1\n");
    expect(r.diff?.files[0].after).toBe("v2\n");
  });

  it("rejects ignored beforePath", async () => {
    fs.writeFileSync(path.join(dir, ".env"), "S=1\n");
    const { ctx } = buildCtx({ root: dir });
    const r = await showDiffTool.execute(
      { path: ".env", beforePath: ".env", after: "S=2\n" },
      ctx,
    );
    expect(r.error).toMatch(/ignored/);
  });

  it("rejects oversized payload", async () => {
    const big = "x".repeat(150 * 1024);
    const { ctx } = buildCtx({ root: dir });
    const r = await showDiffTool.execute(
      { path: "big.txt", before: big, after: big },
      ctx,
    );
    expect(r.error).toMatch(/exceeds/);
  });
});

describe("update_todo_list", () => {
  it("forwards items to the flow bridge", async () => {
    const { ctx, spy } = buildCtx({ taskId: "task-1" });
    const items: ToolTodoItem[] = [
      { id: "1", text: "do thing", status: "in_progress" },
      { id: "2", text: "second", status: "pending" },
    ];
    const r = await updateTodoListTool.execute({ items }, ctx);
    expect(r.error).toBeUndefined();
    expect(spy.todos).toHaveLength(1);
    expect(spy.todos[0].taskId).toBe("task-1");
    expect(spy.todos[0].items.length).toBe(2);
    expect(r.content).toMatch(/2 item/);
  });

  it("errors when no active task", async () => {
    const { ctx } = buildCtx({ taskId: undefined });
    const r = await updateTodoListTool.execute({ items: [] }, ctx);
    expect(r.error).toMatch(/no active task/);
  });
});

describe("queue_message", () => {
  it("enqueues with default priority 0", async () => {
    const { ctx, spy } = buildCtx();
    const r = await queueMessageTool.execute({ text: "follow up" }, ctx);
    expect(r.error).toBeUndefined();
    expect(spy.queued).toHaveLength(1);
    expect(spy.queued[0]).toMatchObject({ text: "follow up", priority: 0 });
  });

  it("forwards overrides", async () => {
    const { ctx, spy } = buildCtx();
    await queueMessageTool.execute(
      { text: "later", priority: 5, modeOverride: "code" },
      ctx,
    );
    expect(spy.queued[0]).toMatchObject({ priority: 5, modeOverride: "code" });
  });
});

describe("summarize_session", () => {
  it("records the summary against the active task", async () => {
    const { ctx, spy } = buildCtx({ taskId: "task-7" });
    const r = await summarizeSessionTool.execute(
      { summary: "implemented stage 15 tools" },
      ctx,
    );
    expect(r.error).toBeUndefined();
    expect(spy.summaries[0]).toEqual({ taskId: "task-7", summary: "implemented stage 15 tools" });
  });

  it("errors when no active task", async () => {
    const { ctx } = buildCtx({ taskId: undefined });
    const r = await summarizeSessionTool.execute({ summary: "x" }, ctx);
    expect(r.error).toMatch(/no active task/);
  });
});
