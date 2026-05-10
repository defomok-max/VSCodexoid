# Contributing to NexusCode Agent

Thanks for your interest! NexusCode is in active development. PRs are
welcome — read this short guide first.

## Prerequisites

- Node.js ≥ 18
- pnpm ≥ 9 (the repo ships a `pnpm-lock.yaml`)
- VS Code ≥ 1.90 for running the Extension Development Host

## Getting started

```bash
git clone https://github.com/defomok-max/VSCodexoid.git
cd VSCodexoid
pnpm install
pnpm run build:dev
```

In VS Code: open this folder, press **F5** to launch the
**Extension Development Host**, then click the NexusCode icon in the activity
bar.

## Day-to-day commands

```bash
pnpm run watch       # esbuild + tailwind in watch mode
pnpm run typecheck   # tsc --noEmit
pnpm run lint        # eslint --max-warnings=0
pnpm run test        # vitest run
pnpm run test:watch  # vitest watch
pnpm run build       # production bundles into dist/
pnpm run package     # produce a .vsix via vsce
```

The Stage 7 baseline before opening a PR is:

- `pnpm run typecheck` — clean
- `pnpm run lint` — clean
- `pnpm run test` — all green
- `pnpm run build` — succeeds (extension + webview bundles)

## Branching and stages

The repo follows a staged-build workflow tracked in [`STATUS.md`](../STATUS.md).
Active work lands on the `dev` branch via stage branches
(`stage-N/<topic>`); the `main` branch is the published baseline and only
receives a single squash merge from `dev` per major milestone.

For contributors: branch off `dev`, name your branch `feat/<topic>` or
`fix/<topic>`, and target `dev` in your PR. Don't open PRs directly into
`main`.

## Repository layout

See [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md) for the full breakdown. The
short version:

```
src/
  extension.ts                — VS Code activate(); wires everything together
  shared/                     — types + protocol shared between host and webview
  core/
    agent/                    — agent runner, queue, task manager, approval gate
    providers/                — LLM adapters + registry + default profiles
    tools/                    — ToolRegistry + 33 built-in tools
    skills/                   — registry, loader, 20 built-in skills
    mcp/                      — JSON-RPC stdio MCP client + manager
    approval/                 — policy matrix + dynamic command risk
    security/                 — ignore matcher, secret scanner, path guard
    context/                  — context refs + token budget packer
    edit/                     — patch engine (LCS diff, hunk accept/reject)
    checkpoint/               — on-disk file snapshots
    storage/                  — settings + recent tasks
    modes/                    — built-in mode profiles
  webview/                    — React + Tailwind UI
tests/                        — vitest suites
docs/                         — design docs (this folder)
media/                        — icons and static assets
```

## Adding a new provider

1. Implement `LLMProvider` in `src/core/providers/<name>.ts`. Use
   `util/sse.ts` for SSE streaming and propagate the request `AbortSignal`.
2. Add a `ProviderType` value to `shared/types.ts`.
3. Wire the new type into `providerRegistry.ts` (`buildProvider` switch).
4. Add a default profile in `DEFAULT_PROFILES` if you want it offered out of
   the box.
5. Add a test in `tests/providers.test.ts` exercising at least
   `chat`/`stream` with a mocked `fetch`.

Capability flags (`supportsTools`, `supportsVision`, etc.) influence what the
agent loop will request. Set them honestly — the runner trusts them.

## Adding a new tool

1. Create `src/core/tools/builtin/<x>.ts` exporting a `ToolDefinition`.
2. Define the args shape with **Zod** (`schema`) and the JSON Schema mirror
   (`parameters`) the LLM sees. `zod-to-json-schema` is not used; we hand-
   roll the JSON Schema to keep it small and tool-friendly.
3. Set a static `riskLevel`. If the risk depends on args, add an
   `assessRisk(args)` callback.
4. Implement `execute(args, ctx)`. Any I/O must:
   - resolve paths through `ctx.security.resolveWorkspacePath`,
   - check `ctx.security.isIgnored(path)`,
   - run text outputs through `ctx.security.scanSecrets`,
   - propagate `ctx.signal` into every external call.
5. Register the tool in `core/tools/builtin/index.ts`.
6. Add a test in `tests/tools.test.ts`.
7. Decide which modes should expose the tool and update
   `core/modes/builtInModes.ts` accordingly.

## Adding a new built-in skill

Edit `src/core/skills/builtInSkills.ts` and append a `SkillDefinition`. Keep
`triggers[]` short, varied, and bilingual where useful (English + Russian).
`allowedTools` must be a subset of what the relevant modes already expose.

For project-specific skills users can drop a JSON file into
`.nexus/skills/<id>.skill.json` — see the loader at
`src/core/skills/skillLoader.ts`.

## Code style

- TypeScript strict mode (`noImplicitAny`, `strictNullChecks`, etc.). Don't
  silence errors with `as any`. If you need to widen, write the conversion
  explicitly with a typed function.
- Two-space indent, no semicolons-on-`if`, single quotes for strings.
- Functional style for pure transforms; classes for stateful long-lived
  objects (`*Manager`, `*Registry`, `*Store`).
- React: function components only, no class components. Prefer `useMemo` /
  `useCallback` only when measurably needed.
- Tailwind: design tokens live in `src/webview/styles/index.css`. Reach for
  the `nx-*` component classes (e.g. `nx-card`, `nx-btn`) before piling on
  utility classes.
- Keep files small. If a module crosses ~300 lines, look for a split.

## Tests

- Unit tests use **vitest**. Run a single file with
  `pnpm vitest run tests/<file>.test.ts`.
- The VS Code API is mocked in `tests/__mocks__/vscode.ts`. Add to the mock
  rather than introducing a new shim.
- Every public-facing module (`core/<area>/<x>.ts`) should have at least one
  test file. End-to-end behaviour of the agent loop lives in
  `tests/agentRunner.test.ts`.

## Commits and PRs

- Keep commits small and topical. The repo uses staged-build commits like
  `stage 7: tests + docs`; outside the staged-build flow, conventional
  commit messages are fine (`feat:`, `fix:`, `docs:`, `chore:`, etc.).
- A PR description should answer: *what changed, why, how to verify*.
- Run `pnpm run typecheck && pnpm run lint && pnpm run test` locally before
  opening a PR. CI runs the same checks plus `pnpm run package` on every PR
  targeting `dev` or `main` (see `.github/workflows/ci.yml`); the produced
  `.vsix` is uploaded as a build artifact for that run.

## License

By submitting a PR you agree your contribution is licensed under the
repository's MIT license.
