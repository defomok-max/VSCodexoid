# NexusCode Agent — Implementation Status

This file tracks the staged build of the extension. Each stage is committed and
pushed to the `dev` branch in order. Completed stages are marked with `[x]`,
the in-progress stage with `[~]`, and pending ones with `[ ]`.

The final PR target is `dev → main`.

---

## Stages

- [x] **Stage 1 — Scaffold**
  - VS Code extension manifest with all `nexus.*` commands & settings
  - TypeScript strict, esbuild, Tailwind, ESLint, vitest, vsce
  - Shared types + extension⇄webview protocol
  - React + Tailwind webview shell (light/dark/system, soft cards, Framer Motion)
  - TopBar, Sidebar, ChatView (empty state + queue panel + Send / Queue / Send Now), DiffPanel, ApprovalDialog
  - Settings / Providers / MCP / Skills / Modes / Tasks views (UI surface; logic lands in later stages)
  - `WebviewProvider` with CSP-locked HTML + nonce
  - `SettingsStore`, `SessionStore`, 9 built-in modes
  - `.nexusrules`, `.nexusignore`, README, LICENSE, `.vscode/launch.json`
  - Typecheck / build / vitest / lint all pass

- [x] **Stage 2 — Provider system**
  - Provider registry & profile store (`globalState`-backed) with 13 default profiles seeded
  - `SecretStorage`-backed `ProviderSecretStore` for API keys
  - `OpenAICompatibleProvider` (chat / stream / listModels, Bearer or `api-key` header) — covers OpenAI, Groq, DeepSeek, xAI, Together, Fireworks, Perplexity, Mistral, OpenRouter, LM Studio, LocalAI, Azure-style endpoints
  - `AnthropicProvider` (Messages API, content blocks, tool_use / tool_result, SSE, thinking budgets for `high`/`extreme` reasoning effort)
  - `GoogleGeminiProvider` (`generateContent` + `streamGenerateContent?alt=sse`)
  - `OllamaProvider` (NDJSON streaming, `/api/tags`)
  - `CustomHttpProvider` (user-defined body template + response path + sse/ndjson parser, query/header/bearer auth)
  - Real Providers UI: add / edit / delete profile, edit base URL & default model, save API key, refresh model list, set default
  - 17 vitest tests for SSE parser, path picker, all 5 adapters, and registry

- [x] **Stage 3 — Tools, approval, security**
  - `ToolRegistry` (Zod schemas + JSON-Schema fragments, risk per tool, dynamic risk via `assessRisk`)
  - 15 built-in tools wired:
    - `read_file`, `list_files`, `write_file`, `edit_file`, `create_file`, `delete_file`, `rename_file`
    - `search_files`, `grep` (literal or regex, file pattern, max results, binary skip)
    - `run_terminal_command` (timeout, abort signal, output capped, output secret-redacted)
    - `get_git_status`, `get_git_diff`, `create_git_branch`, `stage_files`, `commit_changes`
  - `evaluateApproval(policy, risk)` matrix — `manual` / `balanced` / `auto-safe` / `full-auto`
  - `assessCommandRisk()` heuristics for `rm -rf`, `sudo`, `curl|sh`, force-push, destructive db/docker, etc.
  - `IgnoreMatcher` (gitignore-style, `**`/`?`/`!`/anchored/dir-only) with `SAFE_DEFAULT_IGNORES`
  - `scanSecrets()` redactor (OpenAI/Anthropic/GitHub/Google/AWS/Slack/Stripe/JWT/private key/Discord/Telegram)
  - `resolveWorkspacePath()` traversal guard
  - Patch engine — `generateHunks` (LCS line diff), `buildDiffPreview`, `applyHunkMask` (per-hunk accept/reject)
  - 37 new vitest tests → 54 total passing

- [x] **Stage 4 — Context, skills, MCP, checkpoints**
  - `parseContextRefs` for `@file:` / `@folder:` / `@symbol:` / `@terminal` / `@problems` / `@gitdiff[:ref]` / `@openfiles`
  - `buildContextChunks` resolves each reference to file content / folder listing / git diff / problems / open files; redacts secrets and honors `.nexusignore`
  - `packContext` + `packBudget` + `estimateTokens` + `truncateToTokens` token-budget manager
  - `.nexusrules` loader (also falls back to `.nexus/rules.md`); `buildRulesSection` for the system prompt
  - `SkillRegistry` (register / unregister / list / `match(message)` by trigger substring)
  - `loadProjectSkills` reads `.nexus/skills/**/*.skill.json` (graceful per-file errors)
  - **20 built-in skills** — Add Feature, Fix Bug, Refactor, Explain Code, Write Tests, Review PR, Optimize Performance, Write Documentation, API Design, Security Audit, Dependency Audit, Git Commit, Create Branch, DevOps & CI, DB Migration, Frontend Component, API Endpoint, Microbenchmark, Localize, Notebook Cleanup
  - `McpStdioClient` (Content-Length JSON-RPC framing, request correlation, timeouts, abort)
  - `McpManager` (start / stop / aggregate tools, status events, listener wiring)
  - `CheckpointManager` (per-task on-disk snapshots under `globalStorage`, restore, trim by max-count, survives extension restart)
  - Skills + MCP + checkpoints wired into `extension.ts` activation; project skills auto-loaded from workspace
  - +31 new vitest tests → 85 total passing

- [x] **Stage 5 — Agent loop**
  - `QueueManager` (add / remove / edit / move up-down-top / sendNow with behavior / popNext / pause / resume / clear, automatic `next`-tagging by priority)
  - `TaskManager` (create / update / setStatus with terminal-state `endedAt` / appendMessage / recordToolCall / setPlan / setTodo, listener API)
  - `ApprovalGate` (`request()` ↔ `decide()` pairing, `cancelAll()`, listener API)
  - `runAgent()` async generator — system prompt builder (mode + matched skills + `.nexusrules` + custom instructions + tool catalog), provider streaming, tool-call accumulation, Zod arg validation, dynamic risk evaluation, approval-matrix gating, in-process tool execution, looping up to `MAX_ROUNDS`
  - Filters tools by mode `allowedTools` and intersects with skill `allowedTools`
  - Streams `task_start` / `text_delta` / `thinking` / `message_complete` / `tool_call_start` / `tool_pending_approval` / `tool_call_end` / `diff` / `usage` / `task_end` / `error`
  - Wired into `extension.ts`: real `task/start`, `task/stop`, `approval/decide`, `queue/add`, `queue/remove`, `queue/edit`, `queue/move`, `queue/clear`, `queue/pause`, `queue/resume`, `queue/sendNow` handlers
  - Builds context chunks from `@file/@folder/@symbol/@terminal/@problems/@gitdiff/@openfiles` refs and packs into 8000-token budget per turn
  - +20 new vitest tests → 105 total passing

- [x] **Stage 6 — UI polish**
  - Lightweight in-house markdown renderer for chat (`Markdown`): fenced code blocks with `Copy` button, inline code, bold/italic, headers, bullets — keeps the webview bundle slim
  - `ToolCallCard` activity cards with status dot, risk badge, approval-state tag, expandable args/result/error JSON, motion-fade-in
  - `PlanCard` with numbered steps, rationale, expected files, tool hint, per-step risk badge
  - `TodoCard` with status-aware checkbox (pending / in_progress / completed / blocked)
  - `ChatView` upgrade: live auto-scroll, framer-motion message animations, stop-button while running, animated "agent is working" indicator
  - `ApprovalDialog` upgrade: backdrop blur, spring scale-in, **Approve once / Approve & remember / Reject** trio
  - `SkillsView` enhanced: search filter (id, name, description, triggers), expandable cards exposing instructions / workflow / allowed tools / output format / safety constraints, `built-in` vs `project` source tag
  - `ModesView` enhanced: 2-column responsive grid, active-state highlight, policy / reasoning / risk-tolerance tags, allowed-tool count, `whileTap` micro-animation
  - `McpView` enhanced: dedicated "Discovered tools" section listing tools with server attribution, command preview, configured-via-`.nexus/mcp.json` tip
  - `taskManager.recordToolCall()` now merges so `tool_call_end` events do not blow away `tool_call_start` metadata (name, riskLevel, approvalState, args, startedAt)

- [x] **Stage 7 — Tests & docs**
  - vitest tests cover every Stage 7 bucket — 15 files / 105 passing tests:
    - queue manager (`tests/queue.test.ts`, 8)
    - edit engine (`tests/patchEngine.test.ts`, 7)
    - approval policy + heuristics (`tests/approval.test.ts` 11 + `tests/approvalGate.test.ts` 4)
    - secret scanner / ignore matcher / path guard (`tests/security.test.ts`, 12)
    - skills (built-in + project loader) (`tests/skills.test.ts`, 8)
    - context refs + token budget (`tests/context.test.ts`, 11)
    - provider adapters + SSE parser + registry (`tests/providers.test.ts`, 15)
    - tool registry + filesystem tools + secret-redaction (`tests/tools.test.ts`, 7)
    - rules loader (`tests/rules.test.ts`, 6)
    - checkpoint manager (`tests/checkpoint.test.ts`, 3)
    - MCP stdio framing (`tests/mcp.test.ts`, 3)
    - agent runner end-to-end with stubbed provider (`tests/agentRunner.test.ts`, 3)
    - task manager start/end merge (`tests/taskManager.test.ts`, 5)
  - Docs added: `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/CONTRIBUTING.md`, `CHANGELOG.md`
  - `pnpm run package` (vsce, `--no-dependencies`) produces a working `.vsix` (~176 KB, 13 files)
  - `media/icon.png` added so vsce no longer fails on the missing marketplace icon
  - `.vscodeignore` cleaned: `pnpm-lock.yaml`, `STATUS.md`, `CHANGELOG.md`, `.nexus*`, lockfiles, and `.github/` are excluded from the package

- [x] **Stage 8 — GitHub Actions CI**
  - `.github/workflows/ci.yml`: typecheck + lint + test + package on every PR/push to `dev` or `main`, uploads the `.vsix` as a build artifact
  - Node 20 + pnpm 9 + ubuntu-latest, 10-minute timeout
  - `CHANGELOG.md` and `docs/CONTRIBUTING.md` updated to reference CI

- [x] **Stage 9 — HTTP/SSE MCP transport**
  - `McpHttpClient` covers Streamable HTTP (spec 2025-03-26) and legacy HTTP+SSE (spec 2024-11-05)
  - `McpClient` interface unifies stdio and HTTP clients in `McpManager`
  - +5 vitest tests → **110 total**; previous `transport "<x>" not yet implemented` error gone
  - `docs/ARCHITECTURE.md` §11 rewritten to describe all three transports

- [x] **Stage 10 — AWS Bedrock SigV4 adapter**
  - `BedrockProvider` (Converse / ConverseStream APIs) replaces the OpenAI-compatible fallback for `aws-bedrock` profiles
  - `util/sigv4.ts` — pure-TS Signature Version 4 (no `@aws-sdk/*` dependency); uses Node's built-in `crypto`
  - Inline parser for binary `application/vnd.amazon.eventstream` (ConverseStream)
  - Credentials: JSON `apiKey` / `customParameters` / `AWS_*` env vars
  - +12 vitest tests → **122 total**

- [x] **Stage 11 — Dependabot + tag `v0.1.0`**
  - `.github/dependabot.yml`: weekly npm + github-actions updates (Mondays 06:00 UTC, max 5 open PRs each), grouped sensibly (typescript-eslint, vitest, react, tailwind)
  - Conventional commit prefixes: `deps`, `deps-dev`, `ci`
  - Annotated git tag `v0.1.0` placed on commit `522ad3f` (the original Stages 1–8 release commit)

- [x] **Stage 18 — Queue persistence**
  - `QueueStore` (`src/core/storage/queueStore.ts`) — `vscode.Memento`-backed mirror keyed at `nexus.queue.items` / `nexus.queue.paused`; tolerates malformed payloads (non-array → `[]`, truthy paused → `true`)
  - `QueueManager.onChange(cb)` mutation listener; fires on every state change (`add`/`remove`/`edit`/`move`/`sendNow`/`popNext`/`clear`/`setPaused`); `hydrate` does not fire to avoid persist ping-pong on activate; listener errors are isolated
  - `QueueManager.hydrate` filters out terminal-status items (`sent`/`cancelled`/`failed`) and clamps survivors back to `queued`, so a stale memento never resurrects already-sent messages
  - `QueueManager.setPaused` is now a no-op when the value is unchanged
  - `extension.ts` activation: hydrates the queue once and registers a single `onChange` listener that calls `queueStore.save(...)` (fire-and-forget with a `logger.warn` fallback)
  - +8 vitest tests in `tests/queueStore.test.ts` → **218 total** passing
  - Fixes the long-standing JSDoc lie that the host "serializes the queue to globalState whenever a mutation occurs" — the wiring did not exist; pending follow-ups + paused flag now survive a reload

- [x] **Stage 23 — Persisted current-mode preference**
  - `core/storage/preferencesStore.ts` — thin Memento bucket (`globalState["nexus.preferences"]`) for ephemeral UI preferences. `read()`, merge-on-write `update(partial)` (`undefined` = remove), `clear()`. Tolerates corrupt snapshots (non-object reads back as `{}`).
  - `extension.ts` reads `preferencesStore.read().currentMode` on activate (default `"code"`), writes through `setCurrentMode`. Switching to non-default mode now survives reload.
  - +6 vitest tests in `tests/preferencesStore.test.ts`.
  - Schema-permissive: future preferences (last-used provider/model, sidebar width, …) add optional fields, no migration.

- [x] **Stage 19 — Workspace-trust gate**
  - `core/security/workspaceTrust.ts` — `UNTRUSTED_ALLOWED_CATEGORIES` (read | search | diagnostics | todo | ui), `isToolAllowedWhenUntrusted(tool)` (category gate AND static `riskLevel === "safe"` gate), `filterToolsForTrust(tools, trust)`
  - `AgentRunDeps.trusted: boolean` — runner filters its tool set before the LLM sees a tool descriptor; emits a single `error` event with the count of hidden tools and how to grant trust
  - `extension.ts` reads `vscode.workspace.isTrusted` for both the broadcast `AppState.workspaceTrusted` and per-task `runAgent` deps; subscribes to `vscode.workspace.onDidGrantWorkspaceTrust` to patch state and surface a `"Workspace trusted — …"` toast
  - `AppState.workspaceTrusted: boolean` added to the shared protocol (webview banner is a follow-up)
  - +6 vitest tests in `tests/workspaceTrust.test.ts`; existing `tests/agentRunner.test.ts` updated for the new `trusted: true` field on three fake deps
  - Fixes the `docs/SECURITY` promise that "untrusted workspaces disable shell tools entirely" — `vscode.workspace.isTrusted` was previously not read anywhere

- [x] **Stage 22 — Workspace-trust UI banner**
  - `webview/components/common/TrustBanner.tsx` — persistent amber banner under TopBar when `state.workspaceTrusted === false`. "Manage trust" button opens the built-in `workbench.trust.manage` dialog via the `command/run` round-trip.
  - `core/security/commandAllowlist.ts` — `ALLOWED_WEBVIEW_COMMANDS` set (`workbench.trust.manage`, `workbench.action.openSettings`, `workbench.action.reloadWindow`) + `isAllowedWebviewCommand(cmd)` helper.
  - `extension.ts` `command/run` handler (was declared in Stage 1 but never wired) — consults the allowlist, calls `vscode.commands.executeCommand`, surfaces failures as toasts.
  - +5 vitest tests in `tests/commandAllowlist.test.ts`. **221 total** on top of stage-19 (216 + 5).
  - Stacks on Stage 19. Once Stage 19 lands on `main`, this PR rebases trivially.

- [x] **Stage 17d — Multimodal / image input**
  - `AttachmentRef` extended with inline `dataBase64` + optional `name` so chat messages carry image bytes through the protocol without a side channel.
  - New `core/providers/util/multimodal.ts` helpers: `imageAttachments`, `hasImages`, `toOpenAIContentBlocks`, `toAnthropicImageBlocks`, `toGeminiParts`. Pure functions, fully unit-tested.
  - Provider wiring: `OpenAICompatibleProvider`, `AnthropicProvider`, and `GoogleGeminiProvider` now serialize user-message image attachments into their native multimodal shapes (OpenAI `image_url` data URL, Anthropic `image` base64 source, Gemini `inlineData`).
  - Chat UI: paste-image (`onPaste`), drag-and-drop (`onDragOver` / `onDrop`), thumbnail row above the textarea with per-image remove. Images are previewed inline on user message bubbles. Hard cap 5 MB / image; non-image drops are silently ignored, oversized files surface a warn toast.
  - Protocol: `task/start` carries `attachments?: AttachmentRef[]`; `agentRunner` forwards them to `buildLlmMessages` so they ride on the new user turn (not on the transcript replay).
  - +6 vitest cases in `tests/multimodal.test.ts` → **216 total**

- [x] **Stage 17c — Cost & usage dashboard**
  - New webview view: **Usage** (sidebar `Σ` icon). Aggregates the last 30 tasks (`recentTasks`) by provider and by model, with input/output token totals, per-bucket cost, and a relative-cost bar.
  - Pure aggregation lib in `src/webview/components/Usage/usageMath.ts`: `pricingFor`, `costForTask`, `bucketBy`, `aggregateUsage`, `formatUsd`, `formatTokens`. Unit-tested in `tests/usage.test.ts`.
  - Pricing source of truth: `ProviderProfile.costPerMillionInput / costPerMillionOutput` (added back in stage 2). Tasks under unpriced providers (e.g. local Ollama) are bucketed and shown but contribute $0 — `pricedTaskCount` distinguishes them in the summary.
  - Recent tasks list shows the per-task cost or `"no price"` so the user can see which tasks have pricing data.
  - +7 vitest cases in `tests/usage.test.ts` → **204 total**

- [x] **Stage 17b — Native Cohere + HuggingFace provider adapters**
  - `CohereProvider` (`src/core/providers/cohere.ts`): native `/v2/chat` integration. Translates user / assistant / tool messages into Cohere's content-block + `tool_call_id` shape. Streaming handles `content-delta` / `tool-call-start` / `tool-call-delta` / `message-end` events with usage + finish-reason mapping (`TOOL_CALL` → `tool_calls`, `MAX_TOKENS` → `length`, etc).
  - `HuggingFaceProvider` (`src/core/providers/huggingface.ts`): native Inference Router (`POST {baseUrl}/v1/chat/completions`) with curated fallback model list. Streaming handles OpenAI-shape SSE chunks plus aggregated `tool_calls` deltas indexed by `index`.
  - `providerRegistry.buildProvider()` now dispatches `cohere` → `CohereProvider` and `huggingface` → `HuggingFaceProvider` (instead of the previous OpenAI-compatible fallback).
  - 2 new default profiles: **Cohere** (`command-a-03-2025`) and **Hugging Face** (`meta-llama/Llama-3.3-70B-Instruct`).
  - +9 vitest cases in `tests/cohereHuggingface.test.ts` → **197 total**

- [x] **Stage 17a — Workspace indexing module**
  - New `src/core/indexing/` module: `WorkspaceIndex` (file metadata + symbol entries + lexical inverted index), `extractSymbols` (regex-based, TS/JS/TSX/JSX/MJS/CJS), `InvertedIndex` (TF·IDF over a Map-of-Maps).
  - 3 new built-in tools: `find_symbol` (substring or regex match, optional `kind` filter), `lexical_search` (whole-file relevance ranking), `refresh_index` (cheap on warm caches).
  - `nexus.indexWorkspace` command now actually refreshes the index and reports `files / symbols / unique terms` via toast (instead of the previous placeholder).
  - `ToolContext.index?: ToolIndexBridge` (optional so tests stay minimal); `AgentRunDeps.index` threads it from `extension.ts` to the agent runner.
  - All 3 new tools are added to `COMMON_TOOLS`, so every built-in mode (Ask, Architect, Code, Debug, Review, Test, Docs, DevOps, Security) gets them.
  - Limits: skips ignored paths (`.nexusignore` + safe defaults), 1 MB / file cap, 5000 file cap; binary content is dropped; refreshes coalesce while one is in flight.
  - +9 vitest tests in `tests/indexing.test.ts` → **188 total**

- [x] **Stage 16 — Write/build tools**
  - 4 new built-in tools (`apply_patch`, `format_files`, `run_test_command`, `install_dependency`); registry 29 → **33**
  - `apply_patch`: structured-hunk apply via `applyHunkMask`, returns `ToolResult.diff` (no direct disk writes); rejects mismatched / overlapping / out-of-range hunks
  - `format_files` / `run_test_command` / `install_dependency`: shared `runShell` (cwd-bound spawn, secret scrub, terminal capture, abort, 120s timeout); `install_dependency` auto-detects package manager
  - `run_test_command` uses dynamic `assessCommandRisk` on custom commands
  - +12 vitest tests → **179 total**
  - **All mode-manifest gaps closed** — the registry now matches every tool name referenced from `COMMON_TOOLS` / `EDIT_TOOLS` / `SHELL_TOOLS` / `GIT_TOOLS`

- [x] **Stage 15 — Agent flow tools**
  - 5 new built-in tools (`ask_user`, `show_diff`, `update_todo_list`, `queue_message`, `summarize_session`); registry 24 → 29
  - `ToolContext` gains `flow: ToolFlowBridge` (with `setTodo` / `enqueue` / `recordSummary`); `AgentRunDeps` threads it through; host wires it via `taskManager` / `queueManager`
  - `show_diff` reuses the existing `ToolResult.diff → diff/show` pipeline (no new protocol)
  - +12 vitest tests on a flow-spy → **167 total**

- [x] **Stage 14 — Session persistence**
  - `SessionStore` activated (was `void`-d since stage 5); recent tasks now survive extension reload via `globalState`
  - `taskManager.seed(sessionStore.recentTasks())` on activation, `sessionStore.saveTask(stripTransient(task))` on every terminal status transition (`completed`/`failed`/`cancelled`); streaming hot path untouched
  - `task/clear` message wired: clears both `TaskManager` and `SessionStore`, patches webview
  - `TaskManager` gains `seed(tasks)` (no `onUpdate` fan-out) and `clear()`
  - `RunnerDeps` gains `sessionStore: SessionStore`
  - +9 vitest tests on a Map-backed fake `Memento` → **155 total**

- [x] **Stage 13 — Checkpoint tools**
  - 4 new built-in tools (`create_checkpoint`, `list_checkpoints`, `restore_checkpoint`, `rollback_checkpoint`); registry 20 → 24
  - `ToolContext` gains `checkpoints: ToolCheckpointBridge` (+ optional `taskId`); `AgentRunDeps` threads it through; host wires it as a thin pass-through to the existing `CheckpointManager`
  - Risk: `create_checkpoint` / `list_checkpoints` are `safe`; `restore_checkpoint` / `rollback_checkpoint` are `high` (destructive) — both refuse to write `.nexusignore`d paths
  - Modes' `EDIT_TOOLS` now also includes `list_checkpoints`
  - +10 vitest tests on a real `CheckpointManager` → **146 total**

- [x] **Stage 12 — Workspace inspection tools**
  - 5 new built-in tools (`get_open_files`, `get_selection`, `get_diagnostics`, `get_symbols`, `get_terminal_output`) — all `safe` read-only; modes' `COMMON_TOOLS` set is now fully registered (registry grows from 15 → 20)
  - `core/tools/uiBridgeAdapter.ts` — host-side glue wiring `vscode.window.activeTextEditor`, `vscode.languages.getDiagnostics`, and `vscode.executeDocumentSymbolProvider` into the abstract `ToolUiBridge`
  - `core/tools/builtin/terminalCapture.ts` — 16-entry ring buffer of redacted `run_terminal_command` snapshots; `get_terminal_output` reads from it
  - `ToolUiBridge` interface gains `getDiagnostics` / `getSymbols`; new shared types `EditorSelectionInfo`, `FileDiagnostics`, `DiagnosticInfo`, `SymbolInfo`
  - +14 vitest tests → **136 total**

- [x] **Final** — `dev → main` PR merged at `522ad3f` (Stages 1–8); Stage 9+ ship via individual PRs against `main`.

---

## How to track progress

- This file is updated and committed at the end of each stage.
- Branch in use: `dev` (cumulative).
- Commits are prefixed with `stage N:` so the GitHub history maps 1:1 to the
  list above.
