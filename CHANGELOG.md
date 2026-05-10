# Changelog

All notable changes to **NexusCode Agent** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased] — Stage 8: CI

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
