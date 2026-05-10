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

- [x] **Final** — `dev → main` PR merged at `522ad3f` (Stages 1–8); Stage 9+ ship via individual PRs against `main`.

---

## How to track progress

- This file is updated and committed at the end of each stage.
- Branch in use: `dev` (cumulative).
- Commits are prefixed with `stage N:` so the GitHub history maps 1:1 to the
  list above.
