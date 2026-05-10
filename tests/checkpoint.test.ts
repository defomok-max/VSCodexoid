import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CheckpointManager } from "../src/core/checkpoint/checkpointManager";

describe("CheckpointManager", () => {
  let storage: string;
  let workspace: string;
  beforeEach(() => {
    storage = fs.mkdtempSync(path.join(os.tmpdir(), "nx-cp-storage-"));
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), "nx-cp-ws-"));
  });
  afterEach(() => {
    fs.rmSync(storage, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it("creates a checkpoint and restores files", async () => {
    const cp = new CheckpointManager(storage);
    await cp.init();
    fs.writeFileSync(path.join(workspace, "a.txt"), "old");
    const meta = await cp.create("before-edit", "task1", [{ path: "a.txt", content: "old" }]);
    expect(meta.files).toHaveLength(1);
    fs.writeFileSync(path.join(workspace, "a.txt"), "new");
    const restored = await cp.restore(meta.id, workspace);
    expect(restored).toBe(1);
    expect(fs.readFileSync(path.join(workspace, "a.txt"), "utf8")).toBe("old");
  });

  it("restores a missing-file snapshot by deleting the created file", async () => {
    const cp = new CheckpointManager(storage);
    await cp.init();
    const meta = await cp.create("before-create", "task1", [
      { path: "new.txt", content: CheckpointManager.MISSING_FILE_SENTINEL },
    ]);
    expect(meta.files[0].missing).toBe(true);
    fs.writeFileSync(path.join(workspace, "new.txt"), "new");
    const restored = await cp.restore(meta.id, workspace);
    expect(restored).toBe(1);
    expect(fs.existsSync(path.join(workspace, "new.txt"))).toBe(false);
  });

  it("trims to max count", async () => {
    const cp = new CheckpointManager(storage, 3);
    await cp.init();
    for (let i = 0; i < 5; i++) {
      await cp.create(`cp${i}`, "task", [{ path: "x.txt", content: String(i) }]);
    }
    expect(cp.list().length).toBeLessThanOrEqual(3);
  });

  it("survives manager restart by re-reading meta files", async () => {
    const cp1 = new CheckpointManager(storage);
    await cp1.init();
    await cp1.create("first", "task", [{ path: "a.txt", content: "hi" }]);

    const cp2 = new CheckpointManager(storage);
    await cp2.init();
    expect(cp2.list().length).toBe(1);
  });
});
