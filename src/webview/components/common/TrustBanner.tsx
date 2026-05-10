import { useAppStore } from "../../stores/appStore";

/**
 * Persistent banner shown when `state.workspaceTrusted === false`. The
 * agent is restricted to safe read/search/diagnostics/ui/todo tools in
 * untrusted workspaces (see `core/security/workspaceTrust.ts`); this
 * surfaces that fact directly so users don't get confused by missing
 * tools.
 *
 * The "Manage Workspace Trust" button delegates to the built-in VS Code
 * command via the `command/run` protocol message; the host runs the
 * actual command (the webview is sandboxed and cannot `executeCommand`
 * directly).
 */
export function TrustBanner() {
  const trusted = useAppStore((s) => s.state.workspaceTrusted);
  const send = useAppStore((s) => s.send);
  if (trusted) return null;
  return (
    <div
      role="alert"
      className="bg-amber-500/10 border-b border-amber-500/40 text-amber-200 text-xs px-3 py-2 flex items-center gap-3"
    >
      <span aria-hidden className="font-bold">!</span>
      <span className="flex-1 leading-snug">
        Workspace is <strong>not trusted</strong>. The agent can only call
        read-only / search / diagnostics tools — shell, edit, git, and
        network tools are hidden.
      </span>
      <button
        className="nx-btn text-xs px-2 py-1"
        onClick={() => send({ type: "command/run", command: "workbench.trust.manage" })}
      >
        Manage trust
      </button>
    </div>
  );
}
