import type { ToolCategory } from "../tools/toolTypes";
import type { RiskLevel } from "../../shared/types";

/**
 * Workspace-trust gate. Mirrors VS Code's
 * [`Workspace Trust`](https://code.visualstudio.com/docs/editor/workspace-trust)
 * concept: when a workspace is **untrusted**, the agent is restricted to
 * read-only / inspect-only tools. Anything that can mutate the filesystem,
 * spawn a process, hit the network, or rewrite git state is filtered out
 * before the LLM ever sees the tool descriptor.
 *
 * The host implementation in `extension.ts` wraps `vscode.workspace.isTrusted`
 * (and `onDidGrantWorkspaceTrust`); tests use a plain literal value.
 */
export interface WorkspaceTrustState {
  /** True when the user has marked the workspace trusted. */
  isTrusted: boolean;
}

/**
 * Tool categories that remain available in an untrusted workspace.
 *
 * The intent is "read-only inspection": the agent can read files, search,
 * inspect diagnostics/symbols, manage its own todo, and exchange messages
 * with the user — but not edit files, run commands, mutate git, hit the
 * network, or restore checkpoints.
 */
export const UNTRUSTED_ALLOWED_CATEGORIES: ReadonlyArray<ToolCategory> = [
  "read",
  "search",
  "diagnostics",
  "todo",
  "ui",
];

/**
 * Returns true when the given tool may run in an untrusted workspace.
 *
 * Both clauses must hold:
 *  1. The category is in the read-only allow-list above.
 *  2. The static `riskLevel` is `safe` — categories alone are not enough,
 *     because some `read`-category tools (e.g. an over-broad `read_file`)
 *     could be tagged with a higher base risk in the future.
 */
export function isToolAllowedWhenUntrusted(tool: {
  category: ToolCategory;
  riskLevel: RiskLevel;
}): boolean {
  if (!UNTRUSTED_ALLOWED_CATEGORIES.includes(tool.category)) return false;
  return tool.riskLevel === "safe";
}

/**
 * Returns the subset of tool ids that should remain visible in an untrusted
 * workspace. `tools` is the post-mode/skill filtered list from the registry.
 */
export function filterToolsForTrust<T extends { id: string; category: ToolCategory; riskLevel: RiskLevel }>(
  tools: ReadonlyArray<T>,
  trust: WorkspaceTrustState,
): T[] {
  if (trust.isTrusted) return [...tools];
  return tools.filter(isToolAllowedWhenUntrusted);
}
