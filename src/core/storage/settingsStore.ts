import * as vscode from "vscode";
import type { ApprovalPolicy, NexusSettings, ReasoningEffort, Theme } from "../../shared/types";

/**
 * Read NexusCode configuration from VS Code workspace settings.
 *
 * The webview holds its own copy of `NexusSettings`; this is the authoritative
 * read of the underlying `nexus.*` configuration. Writes go back through
 * `vscode.workspace.getConfiguration` so they participate in the standard
 * settings UI / per-workspace overrides.
 */
export class SettingsStore {
  private readonly section = "nexus";

  read(): NexusSettings {
    const cfg = vscode.workspace.getConfiguration(this.section);
    return {
      defaultProviderId: cfg.get<string>("defaultProvider", "openai-compatible"),
      defaultModelId: cfg.get<string>("defaultModel", "gpt-4o-mini"),
      approvalPolicy: cfg.get<ApprovalPolicy>("approvalPolicy", "balanced"),
      reasoningEffort: cfg.get<ReasoningEffort>("reasoningEffort", "medium"),
      enableMcp: cfg.get<boolean>("enableMcp", true),
      enableSkills: cfg.get<boolean>("enableSkills", true),
      enableBrowserTools: cfg.get<boolean>("enableBrowserTools", false),
      ui: {
        theme: cfg.get<Theme>("ui.theme", "system"),
        compactMode: cfg.get<boolean>("ui.compactMode", false),
        animations: cfg.get<boolean>("ui.animations", true),
      },
      queue: {
        enabled: cfg.get<boolean>("queue.enabled", true),
        autoSendNext: cfg.get<boolean>("queue.autoSendNext", true),
        allowInterrupt: cfg.get<boolean>("queue.allowInterrupt", true),
        preserveContext: cfg.get<boolean>("queue.preserveContext", true),
        summarizePreviousRun: cfg.get<boolean>("queue.summarizePreviousRun", true),
      },
      checkpoints: {
        enabled: cfg.get<boolean>("checkpoints.enabled", true),
        maxCount: cfg.get<number>("checkpoints.maxCount", 50),
      },
      ignorePatterns: cfg.get<string[]>("ignorePatterns", []),
      customInstructions: cfg.get<string>("customInstructions", ""),
    };
  }

  async write(partial: Partial<NexusSettings>): Promise<void> {
    const cfg = vscode.workspace.getConfiguration(this.section);
    const target = vscode.ConfigurationTarget.Global;
    if (partial.defaultProviderId !== undefined) await cfg.update("defaultProvider", partial.defaultProviderId, target);
    if (partial.defaultModelId !== undefined) await cfg.update("defaultModel", partial.defaultModelId, target);
    if (partial.approvalPolicy !== undefined) await cfg.update("approvalPolicy", partial.approvalPolicy, target);
    if (partial.reasoningEffort !== undefined) await cfg.update("reasoningEffort", partial.reasoningEffort, target);
    if (partial.enableMcp !== undefined) await cfg.update("enableMcp", partial.enableMcp, target);
    if (partial.enableSkills !== undefined) await cfg.update("enableSkills", partial.enableSkills, target);
    if (partial.enableBrowserTools !== undefined) await cfg.update("enableBrowserTools", partial.enableBrowserTools, target);
    if (partial.ui) {
      if (partial.ui.theme !== undefined) await cfg.update("ui.theme", partial.ui.theme, target);
      if (partial.ui.compactMode !== undefined) await cfg.update("ui.compactMode", partial.ui.compactMode, target);
      if (partial.ui.animations !== undefined) await cfg.update("ui.animations", partial.ui.animations, target);
    }
    if (partial.queue) {
      const q = partial.queue;
      if (q.enabled !== undefined) await cfg.update("queue.enabled", q.enabled, target);
      if (q.autoSendNext !== undefined) await cfg.update("queue.autoSendNext", q.autoSendNext, target);
      if (q.allowInterrupt !== undefined) await cfg.update("queue.allowInterrupt", q.allowInterrupt, target);
      if (q.preserveContext !== undefined) await cfg.update("queue.preserveContext", q.preserveContext, target);
      if (q.summarizePreviousRun !== undefined) await cfg.update("queue.summarizePreviousRun", q.summarizePreviousRun, target);
    }
    if (partial.checkpoints) {
      if (partial.checkpoints.enabled !== undefined) await cfg.update("checkpoints.enabled", partial.checkpoints.enabled, target);
      if (partial.checkpoints.maxCount !== undefined) await cfg.update("checkpoints.maxCount", partial.checkpoints.maxCount, target);
    }
    if (partial.ignorePatterns !== undefined) await cfg.update("ignorePatterns", partial.ignorePatterns, target);
    if (partial.customInstructions !== undefined) await cfg.update("customInstructions", partial.customInstructions, target);
  }
}
