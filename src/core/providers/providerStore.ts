import * as vscode from "vscode";
import type { ProviderProfile } from "../../shared/types";
import { DEFAULT_PROFILES } from "./providerRegistry";

const KEY = "nexus.providerProfiles";

/**
 * Persists the array of provider profiles in `globalState`. On first launch
 * we seed `DEFAULT_PROFILES` so the user has a working list immediately.
 */
export class ProviderProfileStore {
  constructor(private readonly state: vscode.Memento) {}

  read(): ProviderProfile[] {
    const stored = this.state.get<ProviderProfile[] | undefined>(KEY, undefined);
    if (!stored || stored.length === 0) return DEFAULT_PROFILES;
    return stored;
  }

  async write(profiles: ProviderProfile[]): Promise<void> {
    await this.state.update(KEY, profiles);
  }

  async resetToDefaults(): Promise<void> {
    await this.state.update(KEY, undefined);
  }
}
