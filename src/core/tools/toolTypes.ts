import type { z } from "zod";
import type { RiskLevel } from "../../shared/types";

/**
 * A tool exposed to the LLM. The agent runner validates `args` with `schema`
 * (Zod), routes through the approval manager based on `riskLevel`, and then
 * calls `execute`. Tools must propagate `ctx.signal` for cancellation.
 */
export interface ToolDefinition<I extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  name: string;
  description: string;
  schema: z.ZodType<I>;
  /** JSON Schema fragment shown to the LLM (derived from the Zod schema). */
  parameters: Record<string, unknown>;
  /** Default risk; can be overridden per call by `assessRisk`. */
  riskLevel: RiskLevel;
  /**
   * Optional dynamic risk evaluator. Useful when risk depends on the args
   * (e.g. `run_terminal_command` is `safe` for `ls` but `critical` for `rm -rf`).
   */
  assessRisk?: (args: I) => RiskLevel;
  /** Tag used for permission filtering by mode / skill. */
  category: ToolCategory;
  /** Whether this tool ever produces a diff that should land in the diff panel. */
  producesDiff?: boolean;
  execute(args: I, ctx: ToolContext): Promise<ToolResult>;
}

export type ToolCategory =
  | "read"
  | "edit"
  | "search"
  | "diagnostics"
  | "shell"
  | "git"
  | "checkpoint"
  | "ui"
  | "network"
  | "todo";

export interface ToolContext {
  workspaceRoot: string | undefined;
  /** AbortSignal for cancellation (pass-through to children). */
  signal: AbortSignal;
  /** Optional logger; tools should not console.log directly. */
  log: (msg: string, ...args: unknown[]) => void;
  /**
   * UI helpers. Implemented by the host extension.
   */
  ui: ToolUiBridge;
  /**
   * Security policy. Tools must consult this before reading / writing files.
   */
  security: ToolSecurityBridge;
}

export interface ToolUiBridge {
  showInfo(msg: string): void;
  showWarning(msg: string): void;
  showError(msg: string): void;
  /** Get the active editor selection, if any. */
  getSelection(): Promise<{ file: string; selection?: { start: { line: number; column: number }; end: { line: number; column: number } } } | undefined>;
  getOpenFiles(): Promise<string[]>;
  /**
   * Ask the user a free-form question. Resolves with the answer or `undefined`
   * if the user dismissed the prompt.
   */
  askUser(question: string): Promise<string | undefined>;
}

export interface ToolSecurityBridge {
  /** Returns `true` if the path matches `.nexusignore` / `.gitignore` rules. */
  isIgnored(absPath: string): boolean;
  /** Resolves a workspace-relative or absolute path; throws on traversal. */
  resolveWorkspacePath(p: string): string;
  /**
   * Scans `content` for secrets and returns a redacted copy plus matches. Tools
   * should redact before sending content into a tool result that may go back
   * to the LLM.
   */
  scanSecrets(content: string): { redacted: string; matches: SecretMatch[] };
}

export interface SecretMatch {
  type: string;
  start: number;
  end: number;
  preview: string;
}

export interface ToolResult {
  /**
   * Markdown- or plaintext-formatted content shown back to the LLM. Tools
   * should keep this short — large outputs go in `attachments`.
   */
  content: string;
  /**
   * Optional structured payload (preserved verbatim for follow-up tools).
   */
  data?: unknown;
  /**
   * Attached files (e.g., a diff preview, a captured terminal log).
   */
  attachments?: ToolAttachment[];
  /**
   * Diff preview to surface in the diff panel for user approval. The agent
   * runner will not actually mutate files until the user accepts.
   */
  diff?: ToolDiff;
  /** Set on user-cancellable tools when the user aborted. */
  cancelled?: boolean;
  /** Set when the tool failed. The runner converts to a `tool` message. */
  error?: string;
}

export interface ToolAttachment {
  filename: string;
  mime: string;
  contents: string; // utf-8
}

export interface ToolDiff {
  /** Repository-relative paths. */
  files: { path: string; before: string; after: string }[];
}
