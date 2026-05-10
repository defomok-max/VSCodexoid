# Changelog

All notable changes to **NexusCode Agent** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased] — Stage 25: Semantic (embeddings-based) workspace index

### Added
- **Embeddings provider abstraction** (`core/providers/embeddingsProvider.ts`)
  — single-method `EmbeddingsProvider` interface that mirrors the chat
  provider abstraction (`embed(texts, opts)`, `id`, `model`, optional
  `dimensions`).
- **Three embeddings adapters**:
  - `OpenAICompatibleEmbeddingsProvider` (`/v1/embeddings`) — covers OpenAI,
    Voyage, Mistral, Together, Fireworks, Groq, OpenRouter, plus Azure
    OpenAI's `api-key` header convention.
  - `OllamaEmbeddingsProvider` — modern `/api/embed` (batched), with a
    transparent fallback to legacy `/api/embeddings` (per-text) on 404/405.
  - `GeminiEmbeddingsProvider` — Google `:batchEmbedContents`, with optional
    `outputDimensionality` override.
- **Factory** `buildEmbeddingsProvider({profile, model, dimensions})` —
  dispatches by `profile.type`, defaulting to OpenAI-compatible for unknown
  types so self-hosted endpoints "just work".
- **Chunker** (`core/indexing/chunker.ts`) — symbol-aware chunking for
  TS/JS/TSX/JSX (one chunk per top-level declaration, tagged with
  `symbolName`/`symbolKind`), generic sliding-window chunking for everything
  else, with hard `maxChars` cap.
- **Vector store** (`core/indexing/vectorStore.ts`) — flat in-memory cosine
  store with `Float32Array` vectors normalized at insert time, top-k search,
  per-file removal, and a JSON-on-disk snapshot that refuses to load when
  provider/model/dimensions don't match.
- **Semantic index** (`core/indexing/semanticIndex.ts`) — orchestrates
  walk → chunk → embed → store → save. Reuses unchanged chunks via
  `contentHash`, drops chunks for files that disappear/become ignored, and
  honours `AbortSignal`.
- **Semantic-index holder** (`core/indexing/semanticIndexHolder.ts`) —
  lifecycle wrapper that lazily resolves the configured embeddings profile,
  rebuilds the index when relevant settings change, and surfaces a clear
  "not available" error when the feature is off / misconfigured.
- **New built-in tools**:
  - `semantic_search(query, k?, filePattern?)` — embeds the query and
    returns top-k chunks with `file:lines\tscore` headers and trimmed
    snippets.
  - `refresh_semantic_index(force?)` — (re)builds the index on demand.
  Both return user-actionable errors when the feature is off.
- **Settings**:
  - `nexus.enableSemanticIndex` (default `false`) — master switch.
  - `nexus.embeddingProvider` (default `""` → use `nexus.defaultProvider`).
  - `nexus.embeddingModel` (default `""`).
  - `nexus.embeddingDimensions` (optional integer override).
  - `nexus.embeddingMaxChunkChars` (default `4000`, range 256–32 000).
- **Settings-change watcher** in `extension.ts` invalidates the holder when
  any of the embedding-related settings change.
- **Tool index bridge** (`ToolIndexBridge`) extended with optional
  `semanticSearch`, `refreshSemantic`, and `semanticStats` hooks. Existing
  callers continue to work unchanged.

### Tests (+33)
- `tests/chunker.test.ts` (6) — empty content, sliding-window for non-TS
  files, symbol-tagged chunks for TS files, oversized symbol splitting,
  fallback to generic windows when no symbols, `maxChars` invariant.
- `tests/vectorStore.test.ts` (7) — dimension validation, cosine ranking,
  top-k ordering, per-id and per-file removal, snapshot round-trip,
  provider/model/dim mismatch rejection, `hashChunkContent` properties.
- `tests/embeddingsAdapters.test.ts` (10) — OpenAI request shape,
  out-of-order index re-sorting, Azure `api-key` header, OpenAI 4xx error
  surfacing; Ollama batched + legacy fallback + 5xx propagation; Gemini
  request shape and missing-key guard; `buildEmbeddingsProvider` dispatch.
- `tests/semanticIndex.test.ts` (5) — multi-file indexing + search,
  ignore-respecting walk, content-hash chunk reuse, file-removal on next
  refresh, `filePattern` filter.
- `tests/semanticTools.test.ts` (5) — graceful fallback when bridge is
  missing the optional hooks, formatted hit output, empty-result message,
  `force` flag forwarding for refresh.
- **Total: 264 → 297 tests passing**.

### Status
- The semantic index is **opt-in** and **off by default** (`nexus.enableSemanticIndex = false`).
  The lexical/symbol index continues to do the heavy lifting; semantic search
  is now wired in as a sibling tool the agent can call when meaning, not
  tokens, is the right retrieval axis.

## [Unreleased] — Stage 24c housekeeping

### Added
- **Persisted current-mode preference.** `core/storage/preferencesStore.ts`
  stores ephemeral UI preferences in VS Code `globalState`. The extension now
  restores the last selected mode on activation and writes mode changes through
  the preferences store, so switching to e.g. `architect` no longer resets to
  `code` after reload.
- **6 new vitest tests** in `tests/preferencesStore.test.ts`.
- **Workspace-trust gate.** `core/security/workspaceTrust.ts` filters the
  agent tool set down to safe read/search/diagnostics/todo/ui tools when VS
  Code marks the workspace untrusted. `AppState.workspaceTrusted` lets the
  webview surface the state.
- **6 new vitest tests** in `tests/workspaceTrust.test.ts`.
- **Workspace-trust UI banner.** `TrustBanner` appears when the workspace is
  untrusted and opens VS Code's trust dialog through an allowlisted
  `command/run` host bridge.
- **Command allowlist** for webview-initiated VS Code commands:
  `workbench.trust.manage`, `workbench.action.openSettings`, and
  `workbench.action.reloadWindow`.
- **5 new vitest tests** in `tests/commandAllowlist.test.ts`.
- **MCP server lifecycle.** User MCP server configs persist in
  `globalState`, optional `.nexus/mcp.json` project entries are merged
  read-only, runnable servers auto-start on activation, and `mcp/save`,
  `mcp/restart`, `mcp/test` handlers manage the running set.
- **9 new vitest tests** in `tests/mcpLifecycle.test.ts`.
- **MCP tool execution.** MCP tool descriptors are reconciled into
  `ToolRegistry` as synthetic network tools, with stable ids/names, standard
  approval routing, workspace-trust filtering, and abort-aware calls.
- **12 new vitest tests** in `tests/mcpToolAdapter.test.ts`.
- **Diff-panel apply flow.** `diff/accept*` and `diff/reject*` host
  handlers now persist per-hunk decisions, create a rollback checkpoint, apply
  accepted file changes to disk once the diff is fully decided, and clear
  rejected/rolled-back previews.
- **5 new vitest tests** in `tests/diffSession.test.ts`.

### Notes
- Mode preference intentionally stays out of `nexus.*` settings, avoiding
  workspace settings churn for a per-user UI choice.
- In untrusted workspaces, shell/edit/git/network/checkpoint tools are hidden
  from the LLM before tool descriptors are sent.
- The webview cannot run arbitrary VS Code commands; `command/run` is scoped to
  the explicit allowlist above.
- `.nexus/mcp.json` accepts either a top-level array or `{ "servers": [...] }`;
  project entries override user entries by id and are never written by the UI.
- MCP result content is rendered into transcript-safe text markers; image and
  resource payloads are not inlined.
- Accepted diff previews write only accepted hunks/files and snapshot the
  previous contents before touching disk, including a missing-file marker so
  rolling back a newly created file deletes it again.

## [0.1.0+stage18] — Stage 18: Queue persistence

### Added
- **`QueueStore`** (`src/core/storage/queueStore.ts`) — thin
  `vscode.Memento`-backed mirror of the message queue. Persists both the
  `items[]` array and the `paused` flag under `nexus.queue.items` /
  `nexus.queue.paused`. Defensive against malformed payloads (non-array items
  collapse to `[]`).
- **`QueueManager.onChange(cb)`** — mutation listener used by the host to
  wire persistence. Fires after `add` / `remove` / `edit` / `move` /
  `sendNow` / `popNext` / `clear` / `setPaused`. Skipped on `hydrate` so a
  startup load never ping-pongs back to disk. Listener errors are swallowed.
- **8 new vitest tests** in `tests/queueStore.test.ts` covering save/read
  round-trip, clear, malformed-payload tolerance, listener firing per
  mutation, no-fire on hydrate, terminal-status item filtering on hydrate,
  and listener-error isolation. **Total: 218 tests** passing.

### Changed
- **`extension.ts` activate flow** — constructs `QueueStore` next to
  `SessionStore`, hydrates the queue once on activation, and registers a
  single `onChange` listener that calls `queueStore.save(...)` on every
  mutation (fire-and-forget with a `logger.warn` fallback on disk-write
  failure). The existing `queue/*` message handlers are unchanged — they
  mutate the manager and the listener handles the disk side.
- **`QueueManager.hydrate`** now filters out terminal-status items
  (`sent` / `cancelled` / `failed`) and clamps any survivors back to
  `queued`, so a stale memento payload from a crash mid-pop cannot
  resurrect already-sent messages.
- **`QueueManager.setPaused`** is now a no-op when the value is unchanged,
  avoiding a redundant disk write on every webview reconnect.

### Fixed
- The `QueueManager` JSDoc previously claimed the host "serializes the
  queue to globalState whenever a mutation occurs" — that wiring did not
  exist. Pending follow-up messages and the paused flag were lost on every
  reload. They now survive.

## [0.1.0+stage17d] — Stage 17d: Multimodal / image input

### Added
- **Image attachments in chat.** Paste an image (Cmd/Ctrl-V) or drag-and-drop
  it onto the chat panel to attach it to the next user turn. Thumbnails
  appear above the textarea with a per-image remove button, and the image
  also renders inline on the user message bubble after sending.
- **Provider serialization.** Vision-capable providers translate inline image
  attachments into their native multimodal content shapes:
  - **OpenAI / OpenAI-compatible**: `content` becomes an array of
    `{ type: "text" }` and `{ type: "image_url", image_url: { url } }` blocks
    (data URLs).
  - **Anthropic**: user content gets `{ type: "image", source: { type: "base64", media_type, data } }` blocks.
  - **Google Gemini**: user `parts[]` gain `{ inlineData: { mimeType, data } }` entries.
- **`AttachmentRef.dataBase64` + `AttachmentRef.name`** for inline raw image
  bytes (no side-channel), with a 5 MB per-image cap on the webview side.
- **Pure helpers** in `src/core/providers/util/multimodal.ts`:
  `imageAttachments`, `hasImages`, `toOpenAIContentBlocks`,
  `toAnthropicImageBlocks`, `toGeminiParts`.
- **Protocol.** `task/start` (and the queued `QueueItem`) carry
  `attachments?: AttachmentRef[]`; `agentRunner` forwards them to
  `buildLlmMessages` so they ride on the fresh user turn.

### Tests
- 6 new vitest cases in `tests/multimodal.test.ts`:
  - `imageAttachments` filters out non-image and missing-data attachments.
  - `hasImages` reflects presence of inline images.
  - `toOpenAIContentBlocks` emits text first, then `image_url` data URLs;
    omits the text block when content is empty.
  - `toAnthropicImageBlocks` emits base64 source blocks.
  - `toGeminiParts` emits text first, then `inlineData` parts.
- Total tests: **204 → 216 passing**.

## [Unreleased] — Stage 17c: Cost & usage dashboard

### Added
- **Usage view** in the webview sidebar (`Σ` icon). Shows:
  - Total cost (USD), total input/output tokens, and average cost per priced
    task across the most recent 30 tasks (`recentTasks`).
  - Per-provider and per-model buckets, sorted by cost descending, with a
    relative-cost bar.
  - The recent tasks list with per-task input/output tokens and computed
    cost (or `"no price"` when the provider has no pricing).
- **Pure aggregation library** at `src/webview/components/Usage/usageMath.ts`:
  - `pricingFor(task, providers)`: looks up `costPerMillionInput` /
    `costPerMillionOutput` from the provider profile.
  - `costForTask(task, providers)`: computes input/output/total USD via
    `(tokens / 1_000_000) * pricePerM`.
  - `bucketBy`, `aggregateUsage`: roll up per-provider and per-model totals.
  - `formatUsd`, `formatTokens`: locale-aware display helpers.
- New `usage` value added to `ViewId` and the sidebar nav.

### Tests
- 7 new vitest cases in `tests/usage.test.ts`:
  - `pricingFor` returns rates when both fields are set; `undefined`
    otherwise.
  - `costForTask` scales by 1M tokens correctly; preserves `priced=false`
    for unpriced providers.
  - `aggregateUsage` totals match per-bucket sums; buckets sort by cost
    descending; unpriced provider buckets are kept (cost = $0).
  - `formatUsd` / `formatTokens`: locale-aware formatting.

**Total: 197 → 204 tests passing.**

## [Unreleased] — Stage 17b: Native Cohere + HuggingFace adapters

### Added
- **`CohereProvider`** (`src/core/providers/cohere.ts`) — native adapter for
  Cohere's `/v2/chat` API. Replaces the previous OpenAI-compatible fallback
  and supports:
  - Cohere's content-block message shape (`tool_call_id` for tool results,
    `tool_calls.function.{name,arguments}` for assistant tool calls).
  - Streaming `content-delta` / `tool-call-start` / `tool-call-delta` /
    `message-end` SSE events with usage + finish-reason mapping
    (`TOOL_CALL` → `tool_calls`, `MAX_TOKENS` → `length`, etc).
  - `/v1/models?endpoint=chat` listing with a curated fallback when no key
    is supplied.
- **`HuggingFaceProvider`** (`src/core/providers/huggingface.ts`) — native
  adapter for the Hugging Face Inference Router
  (`POST {baseUrl}/v1/chat/completions`). Defaults to
  `https://router.huggingface.co`. Supports streaming, tool calls aggregated
  by `index`, and `usage` reporting.
- **2 new default provider profiles** in `DEFAULT_PROFILES`:
  - **Cohere** — `command-a-03-2025` on `https://api.cohere.com`.
  - **Hugging Face** — `meta-llama/Llama-3.3-70B-Instruct` on
    `https://router.huggingface.co`.

### Changed
- `providerRegistry.buildProvider()` now dispatches `cohere` to
  `CohereProvider` and `huggingface` to `HuggingFaceProvider`. The OpenAI-
  compatible fallback is no longer used for these two types.

### Tests
- 9 new vitest cases in `tests/cohereHuggingface.test.ts`:
  - `buildProvider` instance routing for both adapters.
  - Cohere: fallback model list when no key, `/v2/chat` non-streaming with
    tool calls + usage, tool-result message translation (`role: "tool"`,
    `tool_call_id`), full SSE event flow including
    `content-delta` / `tool-call-start` / `tool-call-delta` / `message-end`.
  - Hugging Face: `/v1/chat/completions` non-streaming, `/v1/models` with
    fallback on empty list, full streaming flow with text deltas,
    tool-call aggregation by `index`, usage, and finish reason.

**Total: 188 → 197 tests passing.**

## [Unreleased] — Stage 17a: Workspace indexing module

### Added
- New `src/core/indexing/` module, closing a long-standing documentation gap:
  - `WorkspaceIndex` — in-memory index of file metadata, extracted symbols,
    and a lexical inverted index. Skips `.nexusignore` paths, caps at 1 MB
    per file and 5000 files total, drops binary-looking content, coalesces
    concurrent refreshes, and skips re-tokenising files whose `mtimeMs` and
    content hash haven't changed.
  - `extractSymbols` — regex-based extractor for TS/TSX/JS/JSX/MJS/CJS that
    surfaces top-level `function` / `class` / `interface` / `type` / `enum` /
    `namespace` / `const` / `let` declarations, plus class methods (with
    container) via brace-counting scope tracking.
  - `InvertedIndex` — Map-of-Maps inverted index with TF·IDF scoring
    (`freq * log(1 + N / df)`); tokenizer keeps lowercase ASCII tokens
    `[a-z0-9_]+` of length 2..40.
- **3 new built-in tools** (registry **33 → 36**):
  - `find_symbol` (safe) — search the symbol index by name (case-insensitive
    substring or JS regex); optional `kind` filter.
  - `lexical_search` (safe) — rank workspace files by lexical relevance to a
    query. Faster than `grep` on large repos and returns whole-file scores
    rather than line matches.
  - `refresh_index` (safe) — re-scan the workspace; returns the new index
    size. Cheap on warm caches.
- `nexus.indexWorkspace` command now actually refreshes the index (instead
  of showing a placeholder toast) and reports `files / symbols / unique
  terms` once finished.
- `ToolContext.index?: ToolIndexBridge` (optional, so existing tests and
  minimal hosts keep compiling); `AgentRunDeps.index` threads the bridge
  from `extension.ts` to `agentRunner.ts`.
- All 3 new tools are added to `COMMON_TOOLS`, so every built-in mode (Ask,
  Architect, Code, Debug, Review, Test, Docs, DevOps, Security) sees them.

### Tests
- 9 new vitest cases in `tests/indexing.test.ts`:
  - `extractSymbols`: unsupported file types, full TS surface (functions,
    classes with methods, types, interfaces, enums, namespaces, const/let),
    control-flow keywords are not classified as methods.
  - `InvertedIndex`: tokenizer normalisation, TF·IDF ranking, two-way removal.
  - `WorkspaceIndex`: respects `isIgnored`, finds symbols across files,
    re-indexes changed files, drops removed files on refresh, regex matcher
    narrows symbol search.

**Total: 179 → 188 tests passing.**

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
