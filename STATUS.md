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

- [~] **Stage 2 — Provider system**
  - Provider registry & profiles
  - SecretStorage-backed API key store
  - OpenAI-compatible adapter (chat + streaming + listModels) — covers OpenAI, Groq, DeepSeek, xAI, Together, Fireworks, Perplexity, Mistral, OpenRouter, LM Studio, LocalAI, Azure-style endpoints
  - Anthropic adapter (Messages API, streaming)
  - Google Gemini adapter (generateContent + SSE)
  - Ollama adapter (local listModels + streaming)
  - Generic Custom HTTP provider (user-defined body template, response path, streaming parser)
  - Provider profile JSON schema
  - Real Providers UI (add / edit / delete profile, set API key, refresh model list, mark default)
  - Vitest tests for adapters

- [ ] **Stage 3 — Tools, approval, security**
  - Tool registry (Zod schemas, risk levels, audit log)
  - Built-in tools: read/write/edit/create/delete/rename file, list_files, search_files, grep, get_symbols, get_diagnostics, get_open_files, get_selection, get_terminal_output, run_terminal_command, run_test_command, get_git_status, get_git_diff, create_git_branch, stage_files, commit_changes, create_checkpoint, restore_checkpoint, rollback_checkpoint, fetch_url, ask_user, show_diff, apply_patch, format_files, install_dependency, update_todo_list, queue_message
  - Approval manager + 4 policies (manual / balanced / auto-safe / full-auto)
  - Secret scanner (API keys, tokens, private keys, env values)
  - `.nexusignore` runtime enforcement
  - Patch-based edit engine (unified diff, hunk accept/reject, rollback)

- [ ] **Stage 4 — Context, skills, MCP, checkpoints**
  - Context builder: `@file` / `@folder` / `@symbol` / `@terminal` / `@problems` / `@gitdiff` / `@openfiles` references
  - Token budget manager (relevance ranking, summarization, ignore enforcement)
  - `.nexusrules` loader
  - Skills system: registry, loader (`.nexus/skills/*.skill.json`), 20 built-in skills, runner
  - MCP stdio client + server manager + per-tool permissions + audit log
  - Checkpoint manager (per-task patch store, rollback)

- [ ] **Stage 5 — Agent loop**
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
