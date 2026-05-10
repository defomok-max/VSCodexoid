import * as vscode from "vscode";
import type { TaskRecord } from "../../shared/types";

const KEY_RECENT = "nexus.recentTasks";

/**
 * Persists agent task history into VS Code's `globalState`. We intentionally
 * truncate persisted task records to keep memento payloads small — anything
 * beyond the recent N tasks is dropped, and per-task we drop streamed deltas
 * since they are not needed for resume / fork.
 */
export class SessionStore {
  constructor(private readonly memento: vscode.Memento) {}

  recentTasks(): TaskRecord[] {
    return this.memento.get<TaskRecord[]>(KEY_RECENT, []);
  }

  async saveTask(task: TaskRecord, max = 30): Promise<void> {
    const list = this.recentTasks().filter((t) => t.id !== task.id);
    list.unshift(task);
    await this.memento.update(KEY_RECENT, list.slice(0, max));
  }

  async clear(): Promise<void> {
    await this.memento.update(KEY_RECENT, []);
  }
}
