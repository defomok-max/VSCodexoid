/**
 * Whitelist of VS Code commands the webview is permitted to invoke via the
 * `command/run` protocol message. The webview is sandboxed and cannot run
 * `vscode.commands.executeCommand` directly; instead the host receives a
 * `command/run` message and consults this list before forwarding.
 *
 * Keep this list **small and deliberate**. Only commands whose UX makes
 * sense from the chat sidebar belong here. Adding a command to this list
 * grants the webview the same authority as a user clicking the matching
 * menu item in VS Code.
 */
export const ALLOWED_WEBVIEW_COMMANDS: ReadonlySet<string> = new Set([
  // Workspace trust dialog \u2014 used by the trust banner.
  "workbench.trust.manage",
  // Open the global / workspace settings UI focused on Nexus.
  "workbench.action.openSettings",
  // Reload the window after major config changes.
  "workbench.action.reloadWindow",
]);

/**
 * Returns true iff `command` is on the allowlist. Falls through to false
 * for the empty string and unknown commands.
 */
export function isAllowedWebviewCommand(command: string): boolean {
  return ALLOWED_WEBVIEW_COMMANDS.has(command);
}
