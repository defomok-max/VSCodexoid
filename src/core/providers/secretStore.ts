import * as vscode from "vscode";

/**
 * Thin wrapper around VS Code `SecretStorage` for provider API keys.
 *
 * Each provider profile has an `apiKeySecretRef` (e.g. `"openai"`); the actual
 * key is stored under `nexus.providerKey:{ref}`. We never log or surface key
 * values — only metadata about whether a key exists.
 */
export class ProviderSecretStore {
  private static readonly PREFIX = "nexus.providerKey:";

  constructor(private readonly secrets: vscode.SecretStorage) {}

  async get(ref: string): Promise<string | undefined> {
    if (!ref) return undefined;
    return this.secrets.get(ProviderSecretStore.PREFIX + ref);
  }

  async set(ref: string, value: string): Promise<void> {
    if (!ref) throw new Error("ref required");
    await this.secrets.store(ProviderSecretStore.PREFIX + ref, value);
  }

  async clear(ref: string): Promise<void> {
    if (!ref) return;
    await this.secrets.delete(ProviderSecretStore.PREFIX + ref);
  }

  async hasKey(ref: string): Promise<boolean> {
    if (!ref) return false;
    const v = await this.secrets.get(ProviderSecretStore.PREFIX + ref);
    return !!v;
  }
}
