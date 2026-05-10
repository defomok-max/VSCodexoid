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
  /**
   * Checkpoint store; backs the `create_checkpoint` / `restore_checkpoint` /
   * `rollback_checkpoint` tools.
   */
  checkpoints: ToolCheckpointBridge;
  /**
   * Agent flow bridge; backs `update_todo_list`, `queue_message`,
   * `summarize_session` (which mutate the active task / queue).
   */
  flow: ToolFlowBridge;
  /**
   * Workspace index; backs `find_symbol`, `lexical_search`, and
   * `refresh_index`. Optional so tests / minimal hosts that don't index can
   * still construct a context.
   */
  index?: ToolIndexBridge;
  /** Identifier of the current task (when invoked from the agent loop). */
  taskId?: string;
}

export interface ToolIndexBridge {
  refresh(): Promise<ToolIndexStats>;
  stats(): ToolIndexStats;
  findSymbol(
    name: string,
    opts?: { kind?: string; regex?: boolean; maxResults?: number },
  ): ToolSymbolHit[];
  lexicalSearch(query: string, opts?: { maxResults?: number }): ToolSearchHit[];
  /**
   * Optional semantic-search hook. Implemented when
   * `nexus.enableSemanticIndex` is on and an embeddings provider is wired up;
   * absent otherwise. Tools must check `typeof bridge.semanticSearch ===
   * 'function'` before calling and surface a clear error to the LLM when
   * unavailable.
   */
  semanticSearch?(
    query: string,
    opts?: { k?: number; filePattern?: string; signal?: AbortSignal },
  ): Promise<ToolSemanticHit[]>;
  /** Optional rebuild of the semantic index. */
  refreshSemantic?(opts?: { force?: boolean; signal?: AbortSignal }): Promise<ToolSemanticStats>;
  /** Cheap stats for the semantic index, when one is wired up. */
  semanticStats?(): ToolSemanticStats;
}

export interface ToolIndexStats {
  files: number;
  symbols: number;
  uniqueTerms: number;
  bytesIndexed: number;
}

export interface ToolSemanticHit {
  filePath: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
  symbolName?: string;
  symbolKind?: string;
}

export interface ToolSemanticStats {
  files: number;
  chunks: number;
  providerId: string;
  model: string;
  dimensions: number | undefined;
}

export interface ToolSymbolHit {
  name: string;
  kind: string;
  file: string;
  line: number;
  exported: boolean;
  container?: string;
}

export interface ToolSearchHit {
  path: string;
  score: number;
}

export interface ToolFlowBridge {
  /** Replace the current task's checklist (used by `update_todo_list`). */
  setTodo(taskId: string, items: ToolTodoItem[]): void;
  /**
   * Append a queued message that will be picked up by the agent runner on
   * its next idle iteration. Used by `queue_message`.
   */
  enqueue(item: ToolQueueItemInput): { id: string; createdAt: number };
  /**
   * Record a final summary on the current task; used by `summarize_session`.
   */
  recordSummary(taskId: string, summary: string): void;
}

export interface ToolTodoItem {
  id: string;
  text: string;
  status: "pending" | "in_progress" | "completed" | "blocked";
}

export interface ToolQueueItemInput {
  text: string;
  priority?: number;
  modeOverride?: string;
  providerOverride?: string;
  modelOverride?: string;
}

export interface ToolCheckpointBridge {
  /**
   * Persists a snapshot of the given files. `files[].path` keys are
   * workspace-relative paths.
   */
  create(
    label: string | undefined,
    taskId: string | undefined,
    files: { path: string; content: string }[],
  ): Promise<CheckpointInfo>;
  /** Restores the checkpoint to the given workspace root. Returns file count. */
  restore(id: string, workspaceRoot: string): Promise<number>;
  /** Returns all known checkpoints, newest first. */
  list(): CheckpointInfo[];
}

export interface CheckpointInfo {
  id: string;
  taskId?: string;
  createdAt: number;
  label?: string;
  files: { path: string; bytes: number; missing?: boolean }[];
}

export interface ToolUiBridge {
  showInfo(msg: string): void;
  showWarning(msg: string): void;
  showError(msg: string): void;
  /** Get the active editor selection, if any. */
  getSelection(): Promise<EditorSelectionInfo | undefined>;
  getOpenFiles(): Promise<string[]>;
  /**
   * Returns diagnostics (problems) for the workspace. If `filePath` is given,
   * only diagnostics for that file are returned; otherwise diagnostics for
   * every file with at least one entry are returned.
   */
  getDiagnostics(filePath?: string): Promise<FileDiagnostics[]>;
  /**
   * Returns the document symbol tree for the given file (resolved via the
   * editor's language service). The path is workspace-relative or absolute.
   */
  getSymbols(filePath: string): Promise<SymbolInfo[]>;
  /**
   * Ask the user a free-form question. Resolves with the answer or `undefined`
   * if the user dismissed the prompt.
   */
  askUser(question: string): Promise<string | undefined>;
}

export interface EditorSelectionInfo {
  file: string;
  selection?: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
  /** Selected text (UTF-8). May be empty if no characters are selected. */
  text?: string;
}

export interface FileDiagnostics {
  /** Workspace-relative or absolute path. */
  file: string;
  items: DiagnosticInfo[];
}

export interface DiagnosticInfo {
  severity: "error" | "warning" | "info" | "hint";
  message: string;
  /** 1-based line number. */
  line: number;
  /** 1-based column number. */
  column: number;
  source?: string;
  code?: string;
}

export interface SymbolInfo {
  name: string;
  kind: string;
  /** 1-based line number where the symbol starts. */
  line: number;
  /** 1-based column number where the symbol starts. */
  column: number;
  /** Container symbol name (class / namespace), if any. */
  container?: string;
  detail?: string;
  children?: SymbolInfo[];
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
