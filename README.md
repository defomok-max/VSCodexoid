# NexusCode Agent

An open-source agentic AI coding environment for Visual Studio Code.

NexusCode brings a Claude-like, premium UI together with a real, tool-using AI agent that
reads your project, plans changes, edits files, runs commands, and asks for approval at the
right moments. Inspired by [Cline](https://github.com/cline/cline),
[Roo Code](https://github.com/RooCodeInc/Roo-Code), and Codex IDE — but built around an
extensible architecture with first-class **Skills**, **MCP servers**, **multi-provider** support,
**message queueing**, **checkpoints/rollback**, and **mode-based** workflows.

> Status: early MVP, actively in development. APIs may change.

---

## Highlights

- **Agent loop with plan / act workflow** — collect context → plan → request approval → execute
  tools step by step → summarize.
- **Message queue** like Codex: queue follow-ups while the agent is busy, send-now/interrupt,
  reorder/edit, auto-send next on completion.
- **Multi-provider system** — native adapters for:
  - OpenAI-compatible (Groq / DeepSeek / xAI / Together / Fireworks / Perplexity / Mistral /
    LM Studio / LocalAI / Azure-style endpoints / OpenRouter)
  - Anthropic (Messages API + tool_use + thinking budgets)
  - Google Gemini (`generateContent` / SSE streaming)
  - Ollama (NDJSON streaming)
  - Cohere (`/v2/chat` with content blocks + streaming events)
  - Hugging Face Inference Router (`/v1/chat/completions` + tool-call streaming)
  - AWS Bedrock (Converse / ConverseStream with pure-TS SigV4 signing, **no `@aws-sdk/*`
    dependency**, including binary `application/vnd.amazon.eventstream` parsing)
  - **Custom HTTP** — user-defined body template + response path + sse/ndjson parser, configurable
    from the UI without writing code
- **Multimodal input**: paste, drag-and-drop, or attach images (5 MB cap) on user messages.
  Routed natively to OpenAI `image_url`, Anthropic `image` blocks, and Gemini `inlineData`.
- **Workspace indexing**: lexical inverted index (TF·IDF over a Map-of-Maps) plus a regex symbol
  extractor for TS/JS/TSX/JSX. Three built-in tools: `find_symbol`, `lexical_search`,
  `refresh_index`. Honors `.nexusignore`, 1 MB / file cap, 5000 file cap.
- **Skills system**: 20 built-in skills (React component builder, Test Generator, Refactoring
  Assistant, Security Auditor, …) plus a `.nexus/skills/*.skill.json` loader for custom skills.
- **MCP servers**: stdio + Streamable HTTP (spec 2025-03-26) + legacy HTTP+SSE (2024-11-05)
  clients, server lifecycle (auto-start, restart, test), per-tool permissions, tool reconciliation
  into `ToolRegistry`, abort-aware calls.
- **Modes**: Ask, Architect, Code, Debug, Review, Test, Docs, DevOps, Security, Custom.
  Active mode is persisted across reloads.
- **Approval & safety**: `manual` / `balanced` / `auto-safe` / `full-auto` policies, dynamic risk
  scoring (`rm -rf`, `sudo`, `curl|sh`, force-push, destructive db/docker, …), secret scanner,
  `.nexusignore`, **workspace-trust gate** (untrusted workspaces hide shell/edit/git/network/
  checkpoint tools before the LLM sees them), sandboxed terminal execution.
- **Checkpoints**: every batch of edits creates a checkpoint you can roll back to. Created files
  use a missing-file marker so rollback deletes them again.
- **Diff-panel apply flow**: per-hunk / per-file / accept-all / rollback decisions; only accepted
  hunks are written to disk after a checkpoint snapshot.
- **Cost & usage dashboard**: aggregates the last 30 tasks by provider and model with token
  totals, per-bucket cost, and a relative-cost bar. Uses `costPerMillionInput/Output` from the
  provider profile; unpriced providers (e.g. local Ollama) are bucketed at $0.
- **Claude-like UI**: React + Tailwind, light/dark/system themes, smooth Framer Motion
  transitions, accessible components.
- **Persistence**: queue (with paused flag), recent tasks, current mode, MCP server configs,
  provider profiles — all survive an extension reload.

## Quick start (development)

```bash
pnpm install
pnpm run build:dev
```

Press `F5` in VS Code to launch the **Extension Development Host**, then open the NexusCode icon
in the activity bar.

You can also run:

```bash
pnpm run watch       # rebuild on change
pnpm run typecheck   # tsc --noEmit
pnpm run lint        # eslint
pnpm run test        # vitest
pnpm run package     # produce a .vsix
```

## Configuration

All configuration lives under `nexus.*` in VS Code settings (see
`Preferences → Settings → NexusCode`) plus optional repo-local files:

- `.nexusrules` — natural-language rules injected into the system prompt.
- `.nexusignore` — gitignore-style file list of paths the agent must never read or send.
- `.nexus/providers.json` — provider profiles (api keys are kept in `SecretStorage`, never on disk).
- `.nexus/mcp.json` — MCP server config.
- `.nexus/modes/*.json` — custom modes.
- `.nexus/skills/*.skill.json` — custom skills.
- `.nexus/approval.json` — approval overrides.

## Architecture

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). The high-level layout:

```
src/
  extension.ts                — entry point, command + view registration
  commands/                   — VS Code command handlers
  core/
    agent/                    — agent loop, queue manager, task manager, approval gate
    context/                  — context builder, token budget, @-refs (file/folder/symbol/…)
    tools/                    — tool registry + 33+ built-in tools (file/search/git/terminal/
                                 build/checkpoint/flow/indexing/workspace)
    providers/                — 8 native adapters + registry + 13 default profiles
    mcp/                      — stdio + HTTP/SSE clients, lifecycle, tool reconciler
    skills/                   — skill registry, project loader, 20 built-ins
    approval/                 — evaluateApproval(policy, risk) + assessCommandRisk
    checkpoint/               — on-disk file snapshots, restore, trim
    edit/                     — LCS line-diff patch engine + diff session
    indexing/                 — workspace inverted index, symbol extractor, lexical search
    security/                 — secret scanner, ignore matcher, path guard, command allowlist,
                                 workspace-trust gate
    storage/                  — settings, session, queue, preferences, MCP-config stores
    modes/                    — 9 built-in mode profiles
  webview/                    — React + Tailwind + Zustand UI (Chat, Diff, Queue, Tasks,
                                 Modes, Skills, MCP, Providers, Settings, Usage)
  shared/                     — types and protocol shared between host & webview
```

The extension currently ships with **264 unit tests** across 33 vitest files —
`pnpm run test` is the source of truth.

## Security

NexusCode never writes API keys to disk. They live in VS Code `SecretStorage` and are scrubbed
from any audit logs. Before sending any file content to a model the **secret scanner** runs and
either redacts the match or warns the user. By default the agent **never** runs a shell command
without approval.

See [`docs/SECURITY.md`](docs/SECURITY.md).

## Status

Stages 1–24 of the staged build are complete. Tracked in detail in
[`STATUS.md`](STATUS.md) and [`CHANGELOG.md`](CHANGELOG.md). Areas explicitly
**not** yet implemented (settings flags exist, behavior does not):

- `nexus.enableSemanticIndex` — vector index / embeddings backend.
- `nexus.enableBrowserTools` — in-extension browsing / scraping tools.
- `nexus.enableTelemetry` — opt-in telemetry pipeline.

## Contributing

PRs welcome. See [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md).

## License

MIT — see [`LICENSE`](LICENSE).
