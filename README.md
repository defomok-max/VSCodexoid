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
- **Multi-provider system**: OpenAI-compatible (incl. Groq / DeepSeek / xAI / Together /
  Fireworks / Perplexity), Anthropic, Google Gemini, Ollama, LM Studio, LocalAI, Azure OpenAI,
  AWS Bedrock (placeholder), OpenRouter, and a generic **Custom HTTP** provider you can configure
  from the UI without writing code.
- **Skills system**: 20 built-in skills (React component builder, Test Generator, Refactoring
  Assistant, Security Auditor, …) plus a `.nexus/skills/*.skill.json` loader for custom skills.
- **MCP servers**: stdio + HTTP/SSE MCP clients, per-tool permissions, audit log.
- **Modes**: Ask, Architect, Code, Debug, Review, Test, Docs, DevOps, Security, Custom.
- **Approval & safety**: `manual` / `balanced` / `auto-safe` / `full-auto` policies, secret
  scanner, `.nexusignore`, workspace-trust integration, sandboxed terminal execution.
- **Checkpoints**: every batch of edits creates a checkpoint you can roll back to.
- **Claude-like UI**: React + Tailwind, light/dark/system themes, smooth Framer Motion
  transitions, accessible components.

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
    agent/                    — agent loop, planner, executor, queue, task manager
    context/                  — context builder, token budget, summarizer, references
    tools/                    — tool registry + built-in tools
    providers/                — provider abstraction + adapters
    mcp/                      — MCP client and server manager
    skills/                   — skill registry, loader, runner, built-ins
    approval/                 — approval manager, risk scoring, policies
    checkpoints/              — checkpoint manager + patch store
    git/                      — git wrappers
    indexing/                 — workspace indexer, symbol extractor, lexical search
    security/                 — secret scanner, sanitizer, .nexusignore
    storage/                  — session + settings storage
    modes/                    — built-in mode profiles
  webview/                    — React + Tailwind webview UI
  shared/                     — types and protocol shared between host & webview
```

## Security

NexusCode never writes API keys to disk. They live in VS Code `SecretStorage` and are scrubbed
from any audit logs. Before sending any file content to a model the **secret scanner** runs and
either redacts the match or warns the user. By default the agent **never** runs a shell command
without approval.

See [`docs/SECURITY.md`](docs/SECURITY.md).

## Contributing

PRs welcome. See [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md).

## License

MIT — see [`LICENSE`](LICENSE).
