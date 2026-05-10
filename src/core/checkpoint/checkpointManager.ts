import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { CheckpointMeta } from "../../shared/types";

/**
 * Per-task checkpoint store. A checkpoint captures the previous content of a
 * set of files before an agent applies edits, so the user can roll back the
 * full turn if the result is wrong.
 *
 * Snapshots are stored on-disk under `<storagePath>/checkpoints/<id>/` so
 * they survive extension restarts.
 */
export class CheckpointManager {
  private root: string;
  private maxCount: number;
  private metaIndex: CheckpointMeta[] = [];
  private inMemory = new Map<string, Map<string, string>>(); // checkpointId → (relPath → content)

  constructor(storageRoot: string, maxCount = 50) {
    this.root = path.join(storageRoot, "checkpoints");
    this.maxCount = maxCount;
  }

  async init(): Promise<void> {
    await fs.mkdir(this.root, { recursive: true });
    try {
      const entries = await fs.readdir(this.root, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        const metaPath = path.join(this.root, e.name, "meta.json");
        try {
          const text = await fs.readFile(metaPath, "utf8");
          const meta = JSON.parse(text) as CheckpointMeta;
          this.metaIndex.push(meta);
        } catch {
          /* skip */
        }
      }
      this.metaIndex.sort((a, b) => b.createdAt - a.createdAt);
    } catch {
      /* noop */
    }
  }

  list(): CheckpointMeta[] {
    return [...this.metaIndex];
  }

  /** Saves a snapshot of the given files. `files` keys are workspace-relative paths. */
  async create(label: string | undefined, taskId: string | undefined, files: { path: string; content: string }[]): Promise<CheckpointMeta> {
    const id = `cp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const dir = path.join(this.root, id);
    await fs.mkdir(dir, { recursive: true });
    const map = new Map<string, string>();
    const stored: { path: string; bytes: number }[] = [];
    for (const f of files) {
      const safeName = f.path.replace(/[^a-zA-Z0-9._-]/g, "_");
      const blobPath = path.join(dir, safeName);
      await fs.writeFile(blobPath, f.content, "utf8");
      map.set(f.path, f.content);
      stored.push({ path: f.path, bytes: Buffer.byteLength(f.content, "utf8") });
    }
    const meta: CheckpointMeta = {
      id,
      taskId,
      createdAt: Date.now(),
      label,
      files: stored,
    };
    await fs.writeFile(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2), "utf8");
    this.inMemory.set(id, map);
    this.metaIndex.unshift(meta);
    await this.trim();
    return meta;
  }

  /**
   * Restores all files from a checkpoint to the given workspace root, returning
   * the number of files written.
   */
  async restore(id: string, workspaceRoot: string): Promise<number> {
    const meta = this.metaIndex.find((m) => m.id === id);
    if (!meta) throw new Error(`checkpoint ${id} not found`);
    const dir = path.join(this.root, id);
    let n = 0;
    for (const f of meta.files) {
      const safeName = f.path.replace(/[^a-zA-Z0-9._-]/g, "_");
      const blobPath = path.join(dir, safeName);
      const content = await fs.readFile(blobPath, "utf8");
      const target = path.join(workspaceRoot, f.path);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content, "utf8");
      n++;
    }
    return n;
  }

  async delete(id: string): Promise<void> {
    const dir = path.join(this.root, id);
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch {
      /* noop */
    }
    this.metaIndex = this.metaIndex.filter((m) => m.id !== id);
    this.inMemory.delete(id);
  }

  private async trim(): Promise<void> {
    while (this.metaIndex.length > this.maxCount) {
      const oldest = this.metaIndex.pop()!;
      await this.delete(oldest.id);
    }
  }
}
