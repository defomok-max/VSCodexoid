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

- [~] **Stage 5 — Agent loop**
  - Planner (collect context → produce plan → request approval)
  - Executor (tool loop with cancellation + token streaming)
  - Queue manager (queue/dequeue, reorder, send-now, auto-send next)
  - Task manager (status transitions, persistence, fork/resume)
  - Real `task/start`, `task/stop`, `queue/*`, `approval/decide` handlers
  - End-to-end run from chat input → plan → approval → tool calls → diff → summary

- [ ] **Stage 6 — UI polish & screenshots**
  - Real Providers / Modes / Skills / MCP editor UIs (forms, validation, JSON view)
  - Indexing status / progress UI
  - Plan & todo cards in chat
  - Tool-call activity cards with risk badges and result previews
  - Markdown + code block renderer with copy buttons
  - Animations, empty states, loading states polish
  - README screenshots from running webview

- [ ] **Stage 7 — Tests & docs**
  - vitest tests for: queue manager, edit engine, approval policy, secret scanner, skills loader, context builder, provider adapters
  - `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/CONTRIBUTING.md`, `CHANGELOG.md`
  - `vsce package` produces a working `.vsix`

- [ ] **Final** — open `dev → main` PR with full summary, screenshots, and how-to-test

---

## How to track progress

- This file is updated and committed at the end of each stage.
- Branch in use: `dev` (cumulative).
- Commits are prefixed with `stage N:` so the GitHub history maps 1:1 to the
  list above.
