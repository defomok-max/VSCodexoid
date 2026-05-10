import * as vscode from "vscode";
import { NexusWebviewProvider } from "./webview/webviewProvider";
import { SettingsStore } from "./core/storage/settingsStore";
import { SessionStore } from "./core/storage/sessionStore";
import { builtInModes } from "./core/modes/builtInModes";
import { ProviderRegistry } from "./core/providers/providerRegistry";
import { ProviderProfileStore } from "./core/providers/providerStore";
import { ProviderSecretStore } from "./core/providers/secretStore";
import { ProviderError } from "./core/providers/providerTypes";
import { ToolRegistry } from "./core/tools/toolRegistry";
import { registerBuiltinTools } from "./core/tools/builtin";
import { IgnoreMatcher, SAFE_DEFAULT_IGNORES } from "./core/security/ignoreMatcher";
import { scanSecrets } from "./core/security/secretScanner";
import { resolveWorkspacePath } from "./core/security/pathGuard";
import type { AppState, ModelInfo } from "./shared/types";
import type { HostToWebview, WebviewToHost } from "./shared/protocol";
import { logger } from "./core/util/logger";
import { registerCommands } from "./commands";

/**
 * Extension activation. Wires up:
 *   - the sidebar webview provider
 *   - the settings store (reads `nexus.*` configuration)
 *   - the session store (recent task persistence)
 *   - VS Code commands
 *
 * The agent loop, providers, tools, MCP and skills are intentionally registered
 * lazily during the next stages — this is the scaffold pass that just gets the
 * UI to mount and round-trip messages.
 */
export function activate(context: vscode.ExtensionContext): void {
  logger.info("activating NexusCode Agent");

  const settingsStore = new SettingsStore();
  const sessionStore = new SessionStore(context.globalState);
  const providerProfileStore = new ProviderProfileStore(context.globalState);
  const providerSecretStore = new ProviderSecretStore(context.secrets);
  const providerRegistry = new ProviderRegistry();
  providerRegistry.setProfiles(providerProfileStore.read());
  const modelCache: Record<string, ModelInfo[]> = {};

  const toolRegistry = new ToolRegistry();
  registerBuiltinTools(toolRegistry);

  const provider = new NexusWebviewProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(NexusWebviewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  const buildState = (): AppState => ({
    ready: true,
    settings: settingsStore.read(),
    providers: providerRegistry.list(),
    models: { ...modelCache },
    modes: builtInModes,
    skills: [],
    mcpServers: [],
    mcpTools: [],
    currentMode: "code",
    recentTasks: sessionStore.recentTasks(),
    queue: [],
    queuePaused: false,
    agentBusy: false,
  });

  const post = (msg: HostToWebview) => provider.postMessage(msg);

  context.subscriptions.push(
    provider.onMessage(async (msg: WebviewToHost) => {
      try {
        await handleMessage(msg, {
          post,
          settingsStore,
          providerProfileStore,
          providerSecretStore,
          providerRegistry,
          modelCache,
          buildState,
        });
      } catch (e) {
        logger.error("message handler failed", e);
        post({ type: "toast", level: "error", message: String((e as Error)?.message ?? e) });
      }
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("nexus")) {
        post({ type: "state/patch", patch: { settings: settingsStore.read() } });
      }
    }),
  );

  registerCommands(context, provider);

  // Tool registry / security bridge are not yet exercised in stage 3 — they
  // get wired into the agent loop in stage 5. For now we expose them through
  // the extension exports for unit-testability and so future stages don't have
  // to re-plumb activation.
  void toolRegistry;
  void buildSecurityBridge;

  logger.info("NexusCode Agent activated");
}

function buildSecurityBridge(workspaceRoot: string | undefined) {
  const matcher = new IgnoreMatcher(workspaceRoot ?? process.cwd());
  matcher.addPatterns(SAFE_DEFAULT_IGNORES.join("\n"));
  if (workspaceRoot) {
    matcher.loadFile(".nexusignore");
    matcher.loadFile(".gitignore");
  }
  return {
    isIgnored: (p: string) => matcher.isIgnored(p),
    resolveWorkspacePath: (p: string) => resolveWorkspacePath(workspaceRoot, p),
    scanSecrets: (text: string) => scanSecrets(text),
  };
}

interface MessageDeps {
  post: (m: HostToWebview) => void;
  settingsStore: SettingsStore;
  providerProfileStore: ProviderProfileStore;
  providerSecretStore: ProviderSecretStore;
  providerRegistry: ProviderRegistry;
  modelCache: Record<string, ModelInfo[]>;
  buildState: () => AppState;
}

async function handleMessage(msg: WebviewToHost, deps: MessageDeps): Promise<void> {
  const { post, settingsStore, providerProfileStore, providerSecretStore, providerRegistry, modelCache, buildState } =
    deps;
  switch (msg.type) {
    case "ui/ready":
      post({ type: "state/replace", state: buildState() });
      return;
    case "settings/save":
      await settingsStore.write(msg.partial);
      post({ type: "state/patch", patch: { settings: settingsStore.read() } });
      return;
    case "modes/setActive":
      post({ type: "state/patch", patch: { currentMode: msg.modeId } });
      return;
    case "providers/save":
      await providerProfileStore.write(msg.profiles);
      providerRegistry.setProfiles(msg.profiles);
      post({ type: "state/patch", patch: { providers: providerRegistry.list() } });
      post({ type: "toast", level: "success", message: "Provider profiles saved." });
      return;
    case "providers/secret": {
      const profile = providerRegistry.list().find((p) => p.id === msg.profileId);
      if (!profile) {
        post({ type: "toast", level: "error", message: `Provider ${msg.profileId} not found` });
        return;
      }
      await providerSecretStore.set(profile.apiKeySecretRef ?? profile.id, msg.apiKey);
      post({ type: "toast", level: "success", message: `API key saved for ${profile.name}.` });
      return;
    }
    case "providers/refreshModels":
      try {
        const llm = providerRegistry.get(msg.profileId);
        if (!llm) throw new Error(`provider ${msg.profileId} not found`);
        const apiKey = await providerSecretStore.get(llm.profile.apiKeySecretRef ?? llm.id);
        const models = await llm.listModels({ apiKey });
        modelCache[msg.profileId] = models;
        post({ type: "state/patch", patch: { models: { ...modelCache } } });
        post({ type: "toast", level: "success", message: `Loaded ${models.length} models for ${llm.name}.` });
      } catch (e) {
        const err = e as ProviderError | Error;
        logger.error("refreshModels failed", err);
        post({
          type: "toast",
          level: "error",
          message: `Refresh models failed: ${(err as Error).message}`,
        });
      }
      return;
    case "task/start":
      // Agent loop arrives in stage 5.
      post({
        type: "toast",
        level: "info",
        message: "Agent loop wires up in stage 5. For now this just records the prompt.",
      });
      return;
    default:
      // Other messages are accepted silently; later stages add real handlers.
      return;
  }
}

export function deactivate(): void {
  logger.info("deactivating NexusCode Agent");
}
