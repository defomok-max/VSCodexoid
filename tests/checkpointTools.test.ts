import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createCheckpointTool,
  listCheckpointsTool,
  restoreCheckpointTool,
  rollbackCheckpointTool,
} from "../src/core/tools/builtin/checkpointTools";
import { CheckpointManager } from "../src/core/checkpoint/checkpointManager";
import { IgnoreMatcher, SAFE_DEFAULT_IGNORES } from "../src/core/security/ignoreMatcher";
import { scanSecrets } from "../src/core/security/secretScanner";
import { resolveWorkspacePath } from "../src/core/security/pathGuard";
import type { ToolContext } from "../src/core/tools/toolTypes";

function buildCtx(root: string, manager: CheckpointManager): ToolContext {
  const matcher = new IgnoreMatcher(root);
  matcher.addPatterns(SAFE_DEFAULT_IGNORES.join("\n"));
  return {
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
      askUser: async () => undefined,
    },
    security: {
      isIgnored: (p) => matcher.isIgnored(p),
      resolveWorkspacePath: (p) => resolveWorkspacePath(root, p),
      scanSecrets: (s) => scanSecrets(s),
    },
    checkpoints: {
      create: (label, taskId, files) => manager.create(label, taskId, files),
      restore: (id, ws) => manager.restore(id, ws),
      list: () => manager.list(),
    },
    taskId: "task-1",
  };
}

describe("checkpoint tools", () => {
  let root: string;
  let storage: string;
  let manager: CheckpointManager;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nx-cp-"));
    storage = fs.mkdtempSync(path.join(os.tmpdir(), "nx-cp-store-"));
    manager = new CheckpointManager(storage, 4);
    await manager.init();
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(storage, { recursive: true, force: true });
  });

  it("create_checkpoint snapshots specified files", async () => {
    fs.writeFileSync(path.join(root, "a.txt"), "v1\n");
    fs.writeFileSync(path.join(root, "b.txt"), "two\n");
    const ctx = buildCtx(root, manager);
    const r = await createCheckpointTool.execute(
      { label: "before-edit", paths: ["a.txt", "b.txt"] },
      ctx,
    );
    expect(r.error).toBeUndefined();
    expect(r.content).toMatch(/2 file\(s\)/);
    const list = manager.list();
    expect(list).toHaveLength(1);
    expect(list[0].files.map((f) => f.path).sort()).toEqual(["a.txt", "b.txt"]);
    expect(list[0].label).toBe("before-edit");
  });

  it("create_checkpoint refuses ignored paths", async () => {
    fs.writeFileSync(path.join(root, ".env"), "secret\n");
    const ctx = buildCtx(root, manager);
    const r = await createCheckpointTool.execute({ paths: [".env"] }, ctx);
    expect(r.error).toMatch(/ignored/);
    expect(manager.list()).toHaveLength(0);
  });

  it("create_checkpoint refuses files larger than the limit", async () => {
    const big = "x".repeat(300 * 1024);
    fs.writeFileSync(path.join(root, "big.txt"), big);
    const ctx = buildCtx(root, manager);
    const r = await createCheckpointTool.execute({ paths: ["big.txt"] }, ctx);
    expect(r.error).toMatch(/too big/);
  });

  it("create_checkpoint allows label-only marker without files", async () => {
    const ctx = buildCtx(root, manager);
    const r = await createCheckpointTool.execute({ label: "marker" }, ctx);
    expect(r.error).toBeUndefined();
    expect(r.content).toMatch(/0 file\(s\)/);
  });

  it("list_checkpoints returns newest first", async () => {
    fs.writeFileSync(path.join(root, "a.txt"), "1\n");
    const ctx = buildCtx(root, manager);
    await createCheckpointTool.execute({ label: "first", paths: ["a.txt"] }, ctx);
    await new Promise((r) => setTimeout(r, 5));
    await createCheckpointTool.execute({ label: "second", paths: ["a.txt"] }, ctx);
    const r = await listCheckpointsTool.execute({}, ctx);
    const lines = r.content.split("\n");
    expect(lines[0]).toMatch(/"second"/);
    expect(lines[1]).toMatch(/"first"/);
  });

  it("restore_checkpoint reverts files to the snapshot", async () => {
    fs.writeFileSync(path.join(root, "a.txt"), "original\n");
    const ctx = buildCtx(root, manager);
    const cp = await createCheckpointTool.execute({ paths: ["a.txt"] }, ctx);
    const id = (cp.data as { id: string }).id;
    fs.writeFileSync(path.join(root, "a.txt"), "modified\n");

    const r = await restoreCheckpointTool.execute({ id }, ctx);
    expect(r.error).toBeUndefined();
    expect(r.content).toMatch(/restored 1 file/);
    expect(fs.readFileSync(path.join(root, "a.txt"), "utf8")).toBe("original\n");
  });

  it("restore_checkpoint reports unknown id", async () => {
    const ctx = buildCtx(root, manager);
    const r = await restoreCheckpointTool.execute({ id: "cp_bogus" }, ctx);
    expect(r.error).toMatch(/not found/);
  });

  it("rollback_checkpoint restores the most recent checkpoint", async () => {
    fs.writeFileSync(path.join(root, "a.txt"), "v1\n");
    const ctx = buildCtx(root, manager);
    await createCheckpointTool.execute({ label: "cp1", paths: ["a.txt"] }, ctx);
    fs.writeFileSync(path.join(root, "a.txt"), "v2\n");
    await new Promise((r) => setTimeout(r, 5));
    await createCheckpointTool.execute({ label: "cp2", paths: ["a.txt"] }, ctx);
    fs.writeFileSync(path.join(root, "a.txt"), "v3-bad\n");

    const r = await rollbackCheckpointTool.execute({}, ctx);
    expect(r.error).toBeUndefined();
    expect(r.content).toMatch(/cp2/);
    expect(fs.readFileSync(path.join(root, "a.txt"), "utf8")).toBe("v2\n");
  });

  it("rollback_checkpoint reports empty history", async () => {
    const ctx = buildCtx(root, manager);
    const r = await rollbackCheckpointTool.execute({}, ctx);
    expect(r.error).toMatch(/no checkpoints/);
  });

  it("trims to maxCount oldest first", async () => {
    fs.writeFileSync(path.join(root, "a.txt"), "x\n");
    const ctx = buildCtx(root, manager);
    for (let i = 0; i < 6; i++) {
      await createCheckpointTool.execute({ label: `cp${i}`, paths: ["a.txt"] }, ctx);
      await new Promise((r) => setTimeout(r, 2));
    }
    const list = manager.list();
    expect(list.length).toBe(4);
    expect(list[0].label).toBe("cp5");
    expect(list[3].label).toBe("cp2");
  });
});
