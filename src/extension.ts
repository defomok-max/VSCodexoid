import * as vscode from "vscode";
import { NexusWebviewProvider } from "./webview/webviewProvider";
import { SettingsStore } from "./core/storage/settingsStore";
import { SessionStore } from "./core/storage/sessionStore";
import { builtInModes } from "./core/modes/builtInModes";
import type { AppState } from "./shared/types";
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

  const provider = new NexusWebviewProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(NexusWebviewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  const buildState = (): AppState => ({
    ready: true,
    settings: settingsStore.read(),
    providers: [],
    models: {},
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
        await handleMessage(msg, post, settingsStore, buildState);
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

  logger.info("NexusCode Agent activated");
}

async function handleMessage(
  msg: WebviewToHost,
  post: (m: HostToWebview) => void,
  settingsStore: SettingsStore,
  buildState: () => AppState,
): Promise<void> {
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
    case "task/start":
      // Stage 1: scaffold only — the agent loop ships in the next push.
      post({
        type: "toast",
        level: "info",
        message: "Agent loop wires up in the next stage. Saving prompt to history…",
      });
      return;
    default:
      // Other messages are accepted silently in stage 1; later stages add real handlers.
      return;
  }
}

export function deactivate(): void {
  logger.info("deactivating NexusCode Agent");
}
