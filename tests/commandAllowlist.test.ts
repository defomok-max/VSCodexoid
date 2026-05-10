import { describe, expect, it } from "vitest";
import {
  ALLOWED_WEBVIEW_COMMANDS,
  isAllowedWebviewCommand,
} from "../src/core/security/commandAllowlist";

describe("commandAllowlist", () => {
  it("permits the trust dialog used by TrustBanner", () => {
    expect(isAllowedWebviewCommand("workbench.trust.manage")).toBe(true);
  });

  it("permits the settings UI and reload-window commands", () => {
    expect(isAllowedWebviewCommand("workbench.action.openSettings")).toBe(true);
    expect(isAllowedWebviewCommand("workbench.action.reloadWindow")).toBe(true);
  });

  it("rejects empty / unknown commands", () => {
    expect(isAllowedWebviewCommand("")).toBe(false);
    expect(isAllowedWebviewCommand("workbench.action.terminal.new")).toBe(false);
    expect(isAllowedWebviewCommand("nexus.test")).toBe(false);
  });

  it("does not permit destructive or shell-spawning commands", () => {
    // Sanity: nothing on the allowlist should be able to run a shell, open
    // a terminal, modify files, or close the window. If a future change
    // adds one of these, this test will catch it.
    const dangerous = [
      "workbench.action.terminal.new",
      "workbench.action.terminal.kill",
      "workbench.action.files.save",
      "workbench.action.files.revert",
      "workbench.action.closeWindow",
      "workbench.action.quit",
      "vscode.executeCommandsByType",
    ];
    for (const c of dangerous) {
      expect(ALLOWED_WEBVIEW_COMMANDS.has(c)).toBe(false);
    }
  });

  it("freezes its allowlist (no surprise mutations between calls)", () => {
    const first = [...ALLOWED_WEBVIEW_COMMANDS];
    isAllowedWebviewCommand("workbench.trust.manage");
    isAllowedWebviewCommand("definitely.not.allowed");
    const second = [...ALLOWED_WEBVIEW_COMMANDS];
    expect(second).toEqual(first);
  });
});
