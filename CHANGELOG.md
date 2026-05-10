# Changelog

All notable changes to **NexusCode Agent** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased] — Stage 16: Write/build tools

### Added
- **4 new built-in tools** in `core/tools/builtin/buildTools.ts`, completing
  the long-standing gap with mode manifests. Registry **29 → 33**:
  - `apply_patch` (medium) — applies a structured array of hunks
    (`{startLineBefore, beforeText, afterText}`) to a single file. The tool
    re-computes the result via `applyHunkMask` and surfaces a `ToolResult.diff`
    for the existing approval pipeline; **does not write directly to disk**.
    Validates each hunk's `beforeText` matches the on-disk content,
    detects overlapping hunks, refuses ignored / oversized files, and
    handles missing files (treats as empty `before`).
  - `format_files` (medium) — runs the project formatter (default
    `pnpm exec prettier --write`) over the listed workspace-relative paths.
    Refuses ignored paths up front. Supports a `command` override.
  - `run_test_command` (low/dynamic) — runs the project test command
    (default `pnpm test`) with optional `pattern` for filtering. Risk is
    `assessCommandRisk(...)` when a custom command is given.
  - `install_dependency` (high) — installs a single npm package via the
    detected package manager (auto-detect from `pnpm-lock.yaml` /
    `yarn.lock` / `package-lock.json`, fallback `npm`); supports `dev: true`.
    The package name is restricted by Zod regex to forbid traversal /
    arbitrary characters.
- A shared `runShell` helper inside `buildTools.ts` mirrors
  `terminalTool.ts`: cwd-bound `spawn`, 64 KiB output cap, secret scrub,
  `recordTerminalOutput` push so `get_terminal_output` sees these runs too,
  120s default timeout, abort propagation. Non-zero exit codes surface as
  `error` so the agent can decide to retry / give up.

### Tests
- 12 new vitest cases in `tests/buildTools.test.ts`:
  - `apply_patch`: simple swap, ignored path, mismatched `beforeText`,
    out-of-range hunk, overlapping hunks, no-op (`after === before`).
  - `install_dependency`: invalid package-name rejection, scoped name
    acceptance, abort-before-spawn safety.
  - `run_test_command` and `format_files`: schema validation +
    `format_files` ignored-path early refusal.
- **Total: 167 → 179 tests passing.**

### Notes
- `apply_patch` mirrors the structure of `DiffHunk` so existing webview diff
  rendering applies; the per-hunk approve/reject in the diff panel works
  out of the box.
- `format_files` and `run_test_command` rely on the workspace already having
  the relevant binaries (`prettier`, `vitest`, etc.). Auto-installing is
  intentionally out of scope — the agent should call `install_dependency`
  separately if needed.

## [Unreleased] — Stage 15: Agent flow tools

### Added
- **5 new built-in tools** in `core/tools/builtin/flowTools.ts`, bringing the
  registry to **29 tools**. Closes the second batch of the gap that mode
  manifests have been advertising since stage 7:
  - `ask_user` (low) — wraps the existing `ToolUiBridge.askUser` so the agent
    can prompt the user mid-turn for clarification. Returns `cancelled: true`
    if the user dismisses the prompt.
  - `show_diff` (safe) — surfaces a proposed diff via the existing
    `ToolResult.diff` plumbing **without** writing anything to disk; takes
    `before`/`after` strings or `beforePath`/`afterPath` workspace-relative
    paths. Refuses ignored paths and combined payloads >256 KiB.
  - `update_todo_list` (safe) — replaces the active task's checklist via
    `taskManager.setTodo`. Validated by Zod (max 64 items, 240-char text,
    status enum).
  - `queue_message` (low) — appends a message to the user's queue via
    `queueManager.add`; supports `priority` (0–10) and `mode` / `provider` /
    `model` overrides. The agent uses this to defer follow-up work.
  - `summarize_session` (safe) — records a final markdown summary on the
    active task (`TaskRecord.finalSummary`).
- `ToolContext` extended with `flow: ToolFlowBridge` (and the
  helper types `ToolTodoItem`, `ToolQueueItemInput`).
- `AgentRunDeps` gains `flow`; `agentRunner` threads it into every
  `ToolContext`. The host's flow bridge (in `extension.ts`) wraps
  `taskManager.setTodo` / `taskManager.update({ finalSummary })` /
  `queueManager.add` and posts `state/patch` for queue updates.

### Tests
- 12 new vitest cases in `tests/flowTools.test.ts` driving each tool against
  spies — `ask_user` answer / dismissal, `show_diff` inline / from disk /
  ignored / oversized, `update_todo_list` happy / no-task, `queue_message`
  default / overrides, `summarize_session` happy / no-task. All other test
  files gained a 5-line `flow` stub. **Total: 155 → 167 tests passing.**

### Notes
- `show_diff` uses the existing `ToolResult.diff → AgentEvent.diff →
  HostToWebview.diff/show` pipeline; no protocol changes were needed. The
  webview already supports per-hunk accept/reject for these.

## [Unreleased] — Stage 14: Session persistence

### Added
- **`SessionStore` is now activated** (it existed since stage 5 but was
  intentionally idled with `void SessionStore`). Recent tasks now survive an
  extension reload:
  - On activation, `taskManager.seed(sessionStore.recentTasks())` rehydrates
    the in-memory task store from `globalState`.
  - On every terminal task transition (`completed` / `failed` / `cancelled`),
    a stripped copy is persisted via `sessionStore.saveTask`.
  - The streaming hot path is **not** touched — saves only happen once per
    completed task to keep `globalState` writes cheap.
- `task/clear` is now wired in the message handler — clears both the in-memory
  `TaskManager` and persisted `SessionStore`, then patches the webview with
  empty `recentTasks` / `currentTask`.
- `TaskManager` gains:
  - `seed(tasks)` — populate from persisted history without firing
    `onUpdate` (avoids storming the webview during activation).
  - `clear()` — drop every task and reset `currentId`.
- `RunnerDeps` gains `sessionStore: SessionStore` so message handlers can
  reach it.
- `stripTransient(task)` helper trims runaway `resultPreview`s (256 char cap)
  before each persisted write.

### Tests
- `tests/sessionStore.test.ts` (9 cases) — fake `Memento` Map-backed shim
  exercises empty-load, save/reload roundtrip, dedup-by-id, newest-first
  ordering, max truncation, `clear()`, plus 3 cases for
  `TaskManager.seed`/`clear`. **Total: 146 → 155 tests passing.**

### Notes
- `SessionStore.saveTask` already had `max = 30` baked in as a parameter; the
  default is preserved. We could expose it through `nexus.history.maxTasks`
  setting in a follow-up.

## [Unreleased] — Stage 13: Checkpoint tools

### Added
- **4 new built-in checkpoint tools** wired into `core/tools/builtin/index.ts`,
  bringing the registry to **24 tools** total. The agent can now create
  rollback points before risky edits and restore them autonomously:
  - `create_checkpoint` (safe) — snapshots the listed workspace files; refuses
    `.nexusignore`d / oversized (>256 KiB) / binary files.
  - `list_checkpoints` (safe) — newest-first listing with timestamps, file
    counts, and labels.
  - `restore_checkpoint` (high) — restores a specific checkpoint by id;
    refuses to write any path that's now `.nexusignore`d.
  - `rollback_checkpoint` (high) — convenience wrapper restoring the most
    recent checkpoint.
- `ToolContext` extended with `checkpoints: ToolCheckpointBridge` and an
  optional `taskId`. New shared interface `CheckpointInfo` mirrors
  `CheckpointMeta` exactly so the host wiring is a 3-line passthrough to
  `CheckpointManager`.
- `AgentRunDeps` gained a `checkpoints` field; `agentRunner` now threads
  the bridge into every `ToolContext`.
- `COMMON_TOOLS` in built-in modes adds `list_checkpoints` so editor /
  shell modes can introspect the rollback history.
- 10 new vitest cases in `tests/checkpointTools.test.ts` exercising the
  full lifecycle on a real `CheckpointManager` (create with files,
  ignored / oversized / binary refusals, label-only marker, ordering,
  restore reverts files, unknown-id error, rollback restores latest,
  empty-history error, ring-buffer trim to maxCount). **Total: 136 → 146
  tests passing.**

### Changed
- `runTerminalCommandTool`, `agentRunner`, and all tests that build a
  `ToolContext` now provide a `checkpoints` bridge. Existing tests gained
  a 4-line stub.
- Risk levels of `restore_checkpoint` / `rollback_checkpoint` are `high`
  so they trigger the approval gate under `balanced` / `auto-safe`
  policies and auto-execute under `full-auto`.
- `docs/ARCHITECTURE.md` and `docs/CONTRIBUTING.md` reflect the 24-tool
  registry and the new `checkpoint` category.

### Notes
- The webview-side checkpoint API (`checkpoint/create`,
  `checkpoint/restore` protocol messages) is still not handled in
  `extension.ts` `handleMessage` — that's a UI surfacing gap, separate
  from this PR (the agent path now works end-to-end).

## [Unreleased] — Stage 12: Workspace inspection tools

### Added
- **5 new built-in tools** wired into `core/tools/builtin/index.ts`,
  bringing the registry to **20 tools** total. All five are `safe`
  read-only and were previously advertised by built-in modes
  (`COMMON_TOOLS`) but never registered, so the agent could not call them:
  - `get_open_files` — lists files currently open in editors (filters
    `.nexusignore`).
  - `get_selection` — returns the active editor's selection (range +
    selected text), with secret redaction on the captured text.
  - `get_diagnostics` — surfaces `vscode.languages.getDiagnostics()`
    output with optional path / minimum-severity filters.
  - `get_symbols` — returns the document symbol tree for a file via
    `vscode.executeDocumentSymbolProvider`, with optional name filter.
  - `get_terminal_output` — replays the last N captures from
    `run_terminal_command` (newest-first), with stdout/stderr already
    secret-redacted.
- `core/tools/uiBridgeAdapter.ts` — host-side glue that wires the new
  bridge methods to real VS Code APIs (`activeTextEditor`,
  `languages.getDiagnostics`, `vscode.executeDocumentSymbolProvider`,
  `SymbolKind` labels). The previous `extension.ts` `getSelection: () =>
  undefined` stub is replaced with a real implementation.
- `core/tools/builtin/terminalCapture.ts` — small in-memory ring buffer
  (16 entries) that `runTerminalCommandTool` writes to on completion.
  Lets `get_terminal_output` be deterministic and process-local rather
  than relying on a proposed VS Code terminal-data API.
- `ToolUiBridge` extended with `getDiagnostics(filePath?)` and
  `getSymbols(filePath)`. New shared types `EditorSelectionInfo`,
  `FileDiagnostics`, `DiagnosticInfo`, `SymbolInfo` document the
  cross-cutting shape.
- 14 new vitest tests in `tests/workspaceTools.test.ts` cover all five
  tools end-to-end against a stubbed bridge (open-files filter, selection
  redaction + range formatting, diagnostics formatting + severity
  filtering + ignore guard, symbol flattening + container chain + name
  query, terminal-history newest-first ordering). **Total: 136 tests**
  passing.

### Changed
- `runTerminalCommandTool` now records each completed invocation into
  the new ring buffer in addition to its existing return value.
- `docs/ARCHITECTURE.md` and `docs/CONTRIBUTING.md` updated to reflect
  the 20-tool registry, the new `diagnostics` category, and the
  `uiBridgeAdapter` glue layer.

## [Unreleased] — Stage 11: Dependabot + tag v0.1.0

### Added
- `.github/dependabot.yml` — weekly Dependabot version updates for npm and
  GitHub Actions ecosystems (Mondays 06:00 UTC, max 5 open PRs each).
  Sensible groupings: `typescript-eslint`, `vitest`, `react`, `tailwind`
  bundles travel together so a single PR moves a related family of
  dependencies. Commit messages use conventional `deps` / `deps-dev` /
  `ci` prefixes.
- Annotated git tag `v0.1.0` on commit `522ad3f` (the original Stages 1–8
  release). Stage 9 (HTTP/SSE MCP) and Stage 10 (Bedrock SigV4) sit on top
  of the tag and will roll into a future `v0.2.0`.

## [0.1.0+stage10] — Stage 10: AWS Bedrock SigV4 adapter

### Added
- `BedrockProvider` (`src/core/providers/bedrock.ts`) — native AWS Bedrock
  adapter using SigV4 signing and the unified Converse / ConverseStream
  APIs. Works with Anthropic Claude, Meta Llama, Cohere Command, Mistral,
  and Amazon Nova model families.
- `signSigV4` (`src/core/providers/util/sigv4.ts`) — pure-TS AWS Signature
  Version 4 implementation (no `@aws-sdk/*` dependency). Uses Node's
  built-in `crypto` for HMAC-SHA256.
- Inline Bedrock event-stream parser for `application/vnd.amazon.eventstream`
  binary framing (used by `ConverseStream`). Supports `messageStart`,
  `contentBlockStart`, `contentBlockDelta`, `messageStop`, `metadata`.
- `aws-bedrock` default profile in `DEFAULT_PROFILES` pointing at
  `bedrock-runtime.us-east-1.amazonaws.com` with Claude 3.5 Sonnet as default.
- 12 new vitest tests: 7 for SigV4 (determinism, credential scope, payload
  hashing, header sorting, signature flips on payload/region/session-token
  changes), 5 for the Bedrock provider (registry dispatch, signed Converse
  request shape, error surfacing, credential validation, tool-call /
  tool-result message translation). **Total: 122 tests** passing.

### Changed
- `providerRegistry.ts`: `aws-bedrock` profiles now build `BedrockProvider`
  instead of being routed through `OpenAICompatibleProvider`.
- `docs/ARCHITECTURE.md` providers section updated to reflect the new
  dedicated adapter.

## [0.1.0+stage9] — Stage 9: HTTP/SSE MCP transport

### Added
- `McpHttpClient` (`src/core/mcp/mcpHttpClient.ts`) — implements the MCP
  **Streamable HTTP** transport (spec 2025-03-26: single POST endpoint,
  responses can be JSON or `text/event-stream`, `Mcp-Session-Id` propagation)
  and the legacy **HTTP+SSE** transport (spec 2024-11-05: long-lived GET for
  SSE, `event: endpoint` announces the POST URL, `event: message` carries
  JSON-RPC frames). Uses Node 18 native `fetch` and `ReadableStream` — no
  extra runtime dependencies.
- `McpClient` interface (`src/core/mcp/mcpManager.ts`) — common surface for
  stdio and HTTP clients (`start`, `listTools`, `callTool`, `stop`, etc.).
- 5 new vitest tests covering HTTP initialize handshake, JSON ↔ SSE response
  switching, `Mcp-Session-Id` header propagation, non-2xx error surfacing,
  and `McpManager` config validation for `http`/`sse` types missing `url`.
  Total: **110 tests** passing.

### Changed
- `McpManager.startServer` now dispatches to the right client based on
  `cfg.type` (`stdio` → `McpStdioClient`, `http`/`sse` → `McpHttpClient`).
  The previous `transport "<x>" not yet implemented` error is gone.
- `docs/ARCHITECTURE.md` §11 (MCP) rewritten to describe all three
  transports and the `McpClient` interface contract.

## [0.1.0] — Stage 8: CI

### Added
- `.github/workflows/ci.yml` — GitHub Actions pipeline running on every push
  to `main`/`dev` and every PR targeting them. Runs `pnpm install --frozen-lockfile`
  + `typecheck` + `lint` + `test` + `package`, uploads the produced `.vsix`
  as a build artifact. Node 20 + pnpm 9 on `ubuntu-latest`, 10-minute timeout.

## [0.1.0-stage7] — Stage 7: Tests & Docs

### Added
- `docs/ARCHITECTURE.md` — full architecture reference (process model, source
  layout, message protocol, agent loop, providers, tools, approval & risk,
  security, context refs & token budget, skills, MCP, checkpoints, modes,
  state management, build, testing, activation flow, extension points).
- `docs/SECURITY.md` — threat model, layered defences, secret handling, what
  is and isn't covered, vulnerability reporting.
- `docs/CONTRIBUTING.md` — how to set up the dev loop, branch model, code
  style, how to add a provider / tool / skill, testing expectations.
- `CHANGELOG.md` — this file.
- `media/icon.png` — packaged extension icon (256×256), so `vsce package`
  produces a complete `.vsix`.

### Changed
- `.vscodeignore` — exclude `pnpm-lock.yaml`, `STATUS.md`, `CHANGELOG.md`,
  `.nexusignore`, `.nexusrules`, lockfiles, and `.github/` from the
  packaged `.vsix`. Result: smaller, cleaner package.

### Fixed
- `pnpm run package` (vsce) now succeeds end-to-end. Before this stage it
  failed on a missing `media/icon.png` and on vsce's npm-only dependency
  walk; the icon is now provided and `--no-dependencies` is the documented
  way to package, since esbuild already bundles all runtime deps.

## [0.1.0-stage6] — Stage 6: UI polish

### Added
- Custom Markdown renderer for chat (fenced code with copy button, inline
  code, bold/italic, headers, bullets) — no external markdown library.
- `ToolCallCard` component with risk badge, status dot, expandable
  args/result/error, approval state.
- `PlanCard` and `TodoCard` for plan-and-act workflows (numbered steps with
  per-step risk badges; checkboxes for TODO progress).
- Framer Motion animations across chat, approval dialog, queue, and tasks
  views.
- Expanded `ModesView`, `SkillsView`, and `McpView` (search, expandable
  cards, badges for built-in vs project, allowed-tool counts).

## [0.1.0-stage5] — Stage 5: Agent loop

### Added
- `runAgent` async generator that streams typed `AgentEvent`s
  (`task_start` → `text_delta`/`thinking` → `tool_call_start` →
  `tool_pending_approval` → `tool_call_end` → … → `task_end`).
- `QueueManager` (FIFO with reorder, edit, send-now, pause/resume).
- `TaskManager` (in-memory tasks with `recordToolCall` merge logic).
- `ApprovalGate` (request/decide pairing through a Map of pending promises).
- `promptBuilder` (system prompt = mode + skills + .nexusrules +
  customInstructions + tools summary).
- Up to `MAX_ROUNDS = 8` agent rounds per task; full `AbortSignal`
  propagation into providers, tools, and shells.

## [0.1.0-stage4] — Stage 4: Context, Skills, MCP, Checkpoints

### Added
- Context references (`@file`, `@folder`, `@symbol`, `@terminal`,
  `@problems`, `@gitdiff[:ref]`, `@openfiles`) with workspace ignore +
  secret-redaction.
- Token budget packer (`packBudget`, ~4 chars/token estimate, greedy
  priority-based packing, default 8 000 tokens/turn).
- 20 built-in skills with bilingual triggers (Add Feature, Fix Bug,
  Refactor, Explain Code, Write Tests, Review PR, Optimize Performance,
  Documentation, API Design, Security Audit, Dependency Audit, Git Commit,
  Create Branch, DevOps & CI, DB Migration, Frontend Component, API Endpoint,
  Microbenchmark, Localize, Notebook Cleanup).
- Project skill loader (`.nexus/skills/*.skill.json`) with per-file error
  isolation.
- MCP stdio client with Content-Length JSON-RPC framing and request
  correlation. `tools/list` and `tools/call` supported. HTTP/SSE transports
  marked as not-yet-implemented.
- `CheckpointManager` with on-disk per-task snapshots
  (`<globalStorage>/checkpoints/<id>/`), `init/create/restore/delete/trim`,
  default `maxCount = 50`.

## [0.1.0-stage3] — Stage 3: Tools, Approval, Security

### Added
- `ToolRegistry` and 15 built-in tools across read / search / edit / shell
  / git categories.
- Approval matrix (`manual` / `balanced` / `auto-safe` / `full-auto`) with
  hard-coded `auto-reject` of `critical` for every policy.
- `assessCommandRisk` heuristics for shell commands (rm -rf → critical,
  sudo → high, force-push to main → high, destructive SQL → high, …).
- `secretScanner` redactor with ~14 secret-format patterns.
- `IgnoreMatcher` (gitignore syntax) with always-on `SAFE_DEFAULT_IGNORES`
  (env files, ssh keys, AWS creds, build artifacts).
- `pathGuard.resolveWorkspacePath` (traversal protection).
- `patchEngine` with line-based LCS diff and per-hunk accept/reject.

## [0.1.0-stage2] — Stage 2: Providers

### Added
- 5 LLM adapters: OpenAI-compatible (covers OpenAI, Groq, DeepSeek, xAI,
  Together, Fireworks, Perplexity, Mistral, OpenRouter, LM Studio, LocalAI,
  Azure OpenAI, Cohere, HuggingFace, AWS Bedrock), Anthropic, Google Gemini,
  Ollama, Custom HTTP.
- `ProviderRegistry` with 13 default profiles seeded into `globalState`.
- `ProviderSecretStore` over `vscode.SecretStorage` for API keys.
- Capability flags (`supportsTools`, `supportsVision`,
  `supportsReasoningEffort`, `supportsPromptCaching`, `supportsJsonMode`,
  `supportsComputerUse`).
- Settings UI for managing profiles (add / edit / delete / save secret /
  refresh models / set default).

## [0.1.0-stage1] — Stage 1: Scaffold

### Added
- VS Code extension manifest, activity-bar view, command palette entries.
- React + Tailwind webview (TopBar, Sidebar, ChatView, SettingsView,
  ProvidersView, ModesView).
- Light / dark / system theming with a small set of `nx-*` Tailwind
  component classes.
- Zustand store + message bridge (`shared/protocol.ts`, `appStore.ts`).
- 9 built-in modes (ask, architect, code, debug, review, test, docs,
  devops, security).
- `SettingsStore` over `vscode.workspace.getConfiguration("nexus")`.
- `SessionStore` for recent tasks (`globalState`).

[Unreleased]: https://github.com/defomok-max/VSCodexoid/compare/main...dev
