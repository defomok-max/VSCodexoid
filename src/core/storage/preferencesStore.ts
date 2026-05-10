import * as vscode from "vscode";

const KEY = "nexus.preferences";

/**
 * Persisted UI preferences that don't belong in `nexus.*` settings (those
 * are user-editable from the VS Code Settings UI) and don't belong in
 * task history. This is a "scratch pad" the host uses for state the user
 * implicitly mutates by clicking around \u2014 currently:
 *
 *   - **`currentMode`** \u2014 the agent mode the user last selected from the
 *     Modes view. Defaults to `"code"` on first launch. Without
 *     persistence this resets to `"code"` on every reload, which is
 *     surprising for users who work primarily in `architect` / `debug`.
 */
export interface NexusPreferences {
  currentMode?: string;
}

export class PreferencesStore {
  constructor(private readonly memento: vscode.Memento) {}

  read(): NexusPreferences {
    const raw = this.memento.get<NexusPreferences>(KEY, {});
    return raw && typeof raw === "object" ? raw : {};
  }

  /**
   * Merges `partial` into the persisted record. Pass `undefined` for a key
   * to remove it.
   */
  async update(partial: NexusPreferences): Promise<void> {
    const current = this.read();
    const next: NexusPreferences = { ...current };
    for (const [k, v] of Object.entries(partial) as [keyof NexusPreferences, unknown][]) {
      if (v === undefined) delete next[k];
      else (next as Record<string, unknown>)[k] = v;
    }
    await this.memento.update(KEY, next);
  }

  async clear(): Promise<void> {
    await this.memento.update(KEY, undefined);
  }
}
