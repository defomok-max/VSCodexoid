import * as vscode from "vscode";
import type { NexusWebviewProvider } from "../webview/webviewProvider";

/**
 * Registers every `nexus.*` command. Most just route to the sidebar webview;
 * deeper actions (run agent, restore checkpoint, etc) are wired up in later
 * stages where the corresponding services exist.
 */
export function registerCommands(
  context: vscode.ExtensionContext,
  provider: NexusWebviewProvider,
): void {
  const reveal = () => provider.reveal();

  const cmds: Array<[string, (...args: unknown[]) => unknown]> = [
    ["nexus.openChat", reveal],
    ["nexus.newTask", () => {
      reveal();
      provider.postMessage({ type: "diff/clear" });
    }],
    ["nexus.openSettings", () => {
      reveal();
      // The webview routes itself; nothing else needed here.
    }],
    ["nexus.manageProviders", reveal],
    ["nexus.manageMcp", reveal],
    ["nexus.manageSkills", reveal],
    ["nexus.indexWorkspace", () => {
      provider.postMessage({ type: "toast", level: "info", message: "Workspace indexing scheduled." });
    }],
    ["nexus.stopAgent", () => {
      provider.postMessage({ type: "toast", level: "warn", message: "Stop requested." });
    }],
    ["nexus.toggleAutoApprove", async () => {
      const cfg = vscode.workspace.getConfiguration("nexus");
      const cur = cfg.get<string>("approvalPolicy", "balanced");
      const next = cur === "auto-safe" ? "balanced" : "auto-safe";
      await cfg.update("approvalPolicy", next, vscode.ConfigurationTarget.Global);
      provider.postMessage({
        type: "toast",
        level: "info",
        message: `Approval policy: ${next}`,
      });
    }],
    ["nexus.explainSelection", () => {
      reveal();
      provider.postMessage({
        type: "toast",
        level: "info",
        message: "Selection captured — agent run lands in the next stage.",
      });
    }],
    ["nexus.fixSelection", reveal],
    ["nexus.generateTests", reveal],
    ["nexus.reviewDiff", reveal],
    ["nexus.debugError", reveal],
    ["nexus.createCheckpoint", reveal],
    ["nexus.restoreCheckpoint", reveal],
    ["nexus.clearSession", reveal],
    ["nexus.resumeSession", reveal],
    ["nexus.forkSession", reveal],
    ["nexus.queueMessage", reveal],
    ["nexus.clearQueue", () => provider.postMessage({ type: "state/patch", patch: { queue: [] } })],
    ["nexus.pauseQueue", () => provider.postMessage({ type: "state/patch", patch: { queuePaused: true } })],
    ["nexus.resumeQueue", () => provider.postMessage({ type: "state/patch", patch: { queuePaused: false } })],
    ["nexus.sendQueuedNow", reveal],
  ];

  for (const [id, fn] of cmds) {
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  }
}
