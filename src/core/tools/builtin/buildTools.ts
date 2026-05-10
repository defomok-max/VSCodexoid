import * as fs from "node:fs/promises";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { z } from "zod";
import { applyHunkMask, buildDiffPreview } from "../../edit/patchEngine";
import type { DiffHunk } from "../../../shared/types";
import type { ToolContext, ToolDefinition, ToolResult } from "../toolTypes";
import { assessCommandRisk } from "../../approval/approvalManager";
import { recordTerminalOutput } from "./terminalCapture";

const MAX_FILE_BYTES = 256 * 1024;
const MAX_OUTPUT = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;

const HunkSchema = z.object({
  startLineBefore: z.number().int().min(1),
  beforeText: z.string(),
  afterText: z.string(),
});

export const applyPatchTool: ToolDefinition<{
  path: string;
  hunks: { startLineBefore: number; beforeText: string; afterText: string }[];
}> = {
  id: "apply_patch",
  name: "apply_patch",
  description:
    "Applies a structured patch (an array of hunks) to a single file. Each hunk is keyed by its 1-based startLineBefore and supplies beforeText/afterText. The tool re-computes the resulting file and surfaces a full ToolResult.diff for approval — it does NOT write to disk directly. Prefer write_file for greenfield content; prefer apply_patch when you have multiple non-contiguous edits.",
  category: "edit",
  riskLevel: "medium",
  schema: z.object({
    path: z.string().min(1),
    hunks: z.array(HunkSchema).min(1).max(64),
  }),
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Workspace-relative file path." },
      hunks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            startLineBefore: { type: "integer", minimum: 1 },
            beforeText: { type: "string" },
            afterText: { type: "string" },
          },
          required: ["startLineBefore", "beforeText", "afterText"],
        },
      },
    },
    required: ["path", "hunks"],
  },
  async execute(args, ctx): Promise<ToolResult> {
    let abs: string;
    try {
      abs = ctx.security.resolveWorkspacePath(args.path);
    } catch (e) {
      return { content: "", error: (e as Error).message };
    }
    if (ctx.security.isIgnored(abs)) {
      return { content: "", error: `path "${args.path}" is ignored by .nexusignore` };
    }
    let before = "";
    try {
      const buf = await fs.readFile(abs);
      if (buf.length > MAX_FILE_BYTES) {
        return { content: "", error: `"${args.path}" exceeds ${MAX_FILE_BYTES} bytes` };
      }
      before = buf.toString("utf8");
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code !== "ENOENT") {
        return { content: "", error: `cannot read "${args.path}": ${err.message}` };
      }
    }
    const verifyError = verifyHunks(before, args.hunks);
    if (verifyError) {
      return { content: "", error: verifyError };
    }
    const diffHunks: DiffHunk[] = args.hunks.map((h, i) => ({
      id: `h${i}`,
      startLineBefore: h.startLineBefore,
      startLineAfter: h.startLineBefore,
      beforeText: h.beforeText,
      afterText: h.afterText,
      accepted: null,
    }));
    const after = applyHunkMask(before, diffHunks, args.hunks.map(() => true));
    if (after === before) {
      return { content: `apply_patch produced no changes for ${args.path}`, data: { changed: false } };
    }
    return {
      content: `proposed patch for ${args.path} (${args.hunks.length} hunk(s), ${before.length}b -> ${after.length}b)`,
      diff: { files: [buildDiffPreview(args.path, before, after)] },
      data: { changed: true, hunkCount: args.hunks.length, before: before.length, after: after.length },
    };
  },
};

export const formatFilesTool: ToolDefinition<{
  paths: string[];
  command?: string;
}> = {
  id: "format_files",
  name: "format_files",
  description:
    "Runs the project formatter (defaults to `pnpm exec prettier --write`) over the listed workspace-relative paths. Stops if any path is .nexusignore'd. Outputs are captured.",
  category: "shell",
  riskLevel: "medium",
  schema: z.object({
    paths: z.array(z.string().min(1)).min(1).max(128),
    command: z.string().min(1).max(512).optional(),
  }),
  parameters: {
    type: "object",
    properties: {
      paths: { type: "array", items: { type: "string" } },
      command: {
        type: "string",
        description: "Override formatter command. Default: 'pnpm exec prettier --write'.",
      },
    },
    required: ["paths"],
  },
  async execute(args, ctx): Promise<ToolResult> {
    if (!ctx.workspaceRoot) {
      return { content: "", error: "no workspace root" };
    }
    for (const p of args.paths) {
      let abs: string;
      try {
        abs = ctx.security.resolveWorkspacePath(p);
      } catch (e) {
        return { content: "", error: (e as Error).message };
      }
      if (ctx.security.isIgnored(abs)) {
        return { content: "", error: `path "${p}" is ignored by .nexusignore` };
      }
    }
    const cmdBase = args.command ?? "pnpm exec prettier --write";
    const fullCommand = `${cmdBase} ${args.paths.map(quoteArg).join(" ")}`;
    return runShell(fullCommand, ctx.workspaceRoot, ctx);
  },
};

export const runTestCommandTool: ToolDefinition<{
  command?: string;
  pattern?: string;
}> = {
  id: "run_test_command",
  name: "run_test_command",
  description:
    "Runs the project's test suite. Defaults to `pnpm test`. An optional `pattern` is appended verbatim — useful for `vitest -t 'my test'` style filtering. Output is captured for inspection via get_terminal_output.",
  category: "shell",
  riskLevel: "low",
  schema: z.object({
    command: z.string().min(1).max(512).optional(),
    pattern: z.string().max(256).optional(),
  }),
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "Override test command. Default: 'pnpm test'." },
      pattern: { type: "string", description: "Optional pattern appended to the test command." },
    },
  },
  assessRisk(args) {
    if (args.command) return assessCommandRisk(args.command).risk;
    return "low";
  },
  async execute(args, ctx): Promise<ToolResult> {
    if (!ctx.workspaceRoot) {
      return { content: "", error: "no workspace root" };
    }
    const base = args.command ?? "pnpm test";
    const cmd = args.pattern ? `${base} ${quoteArg(args.pattern)}` : base;
    return runShell(cmd, ctx.workspaceRoot, ctx);
  },
};

export const installDependencyTool: ToolDefinition<{
  name: string;
  dev?: boolean;
  packageManager?: "pnpm" | "npm" | "yarn";
}> = {
  id: "install_dependency",
  name: "install_dependency",
  description:
    "Installs a single npm package via the workspace's package manager (auto-detected from the lockfile, override via `packageManager`). Use `dev: true` for a devDependency. Produces a single tool invocation; does NOT install multiple packages at once.",
  category: "shell",
  riskLevel: "high",
  schema: z.object({
    name: z
      .string()
      .min(1)
      .max(214)
      .regex(/^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*(?:@[\w.-]+)?$/i, {
        message: "invalid npm package name",
      }),
    dev: z.boolean().optional(),
    packageManager: z.enum(["pnpm", "npm", "yarn"]).optional(),
  }),
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "npm package name (optionally with @version)." },
      dev: { type: "boolean", description: "Install as devDependency." },
      packageManager: { type: "string", enum: ["pnpm", "npm", "yarn"] },
    },
    required: ["name"],
  },
  async execute(args, ctx): Promise<ToolResult> {
    if (!ctx.workspaceRoot) {
      return { content: "", error: "no workspace root" };
    }
    const pm = args.packageManager ?? (await detectPackageManager(ctx.workspaceRoot));
    const cmd = buildInstallCommand(pm, args.name, args.dev ?? false);
    return runShell(cmd, ctx.workspaceRoot, ctx);
  },
};

async function detectPackageManager(root: string): Promise<"pnpm" | "npm" | "yarn"> {
  const candidates: { file: string; pm: "pnpm" | "npm" | "yarn" }[] = [
    { file: "pnpm-lock.yaml", pm: "pnpm" },
    { file: "yarn.lock", pm: "yarn" },
    { file: "package-lock.json", pm: "npm" },
  ];
  for (const { file, pm } of candidates) {
    try {
      await fs.stat(path.join(root, file));
      return pm;
    } catch {
      // continue
    }
  }
  return "npm";
}

function buildInstallCommand(
  pm: "pnpm" | "npm" | "yarn",
  name: string,
  dev: boolean,
): string {
  const safeName = quoteArg(name);
  if (pm === "pnpm") return dev ? `pnpm add -D ${safeName}` : `pnpm add ${safeName}`;
  if (pm === "yarn") return dev ? `yarn add --dev ${safeName}` : `yarn add ${safeName}`;
  return dev ? `npm install --save-dev ${safeName}` : `npm install ${safeName}`;
}

function verifyHunks(
  before: string,
  hunks: { startLineBefore: number; beforeText: string }[],
): string | null {
  const lines = before.length === 0 ? [] : before.split("\n");
  const sorted = [...hunks].sort((a, b) => a.startLineBefore - b.startLineBefore);
  let prevEnd = 0;
  for (const h of sorted) {
    if (h.startLineBefore - 1 < prevEnd) {
      return `hunks overlap at line ${h.startLineBefore}`;
    }
    const expected = h.beforeText === "" ? [] : h.beforeText.split("\n");
    const sliceEnd = h.startLineBefore - 1 + expected.length;
    if (sliceEnd > lines.length) {
      return `hunk at line ${h.startLineBefore} runs past end of file (${lines.length} lines)`;
    }
    for (let i = 0; i < expected.length; i++) {
      if (lines[h.startLineBefore - 1 + i] !== expected[i]) {
        return `hunk at line ${h.startLineBefore} does not match file (line ${h.startLineBefore + i})`;
      }
    }
    prevEnd = sliceEnd;
  }
  return null;
}

function quoteArg(s: string): string {
  if (s === "") return "''";
  if (/^[A-Za-z0-9_@/.\-+:=,]+$/.test(s)) return s;
  return `'${s.replace(/'/g, "'\\''")}'`;
}

function runShell(command: string, cwd: string, ctx: ToolContext): Promise<ToolResult> {
  return new Promise<ToolResult>((resolve) => {
    if (ctx.signal.aborted) {
      resolve({ content: "", cancelled: true });
      return;
    }
    const child = spawn(command, { cwd, shell: true, env: process.env });
    let stdout = "";
    let stderr = "";
    const onAbort = () => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* noop */
      }
    };
    ctx.signal.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (b: Buffer) => {
      stdout += b.toString("utf8");
      if (stdout.length > MAX_OUTPUT) stdout = stdout.slice(-MAX_OUTPUT);
    });
    child.stderr.on("data", (b: Buffer) => {
      stderr += b.toString("utf8");
      if (stderr.length > MAX_OUTPUT) stderr = stderr.slice(-MAX_OUTPUT);
    });
    child.on("error", (err) => {
      cleanup();
      resolve({ content: "", error: `spawn failed: ${err.message}` });
    });
    child.on("close", (code, signal) => {
      cleanup();
      const { redacted: outRed } = ctx.security.scanSecrets(stdout);
      const { redacted: errRed } = ctx.security.scanSecrets(stderr);
      recordTerminalOutput({
        command,
        cwd,
        stdout: outRed,
        stderr: errRed,
        exitCode: code,
        signal,
        ts: Date.now(),
      });
      const summary =
        (outRed ? `stdout:\n${outRed}\n` : "") +
        (errRed ? `stderr:\n${errRed}\n` : "") +
        `exit: ${code ?? "?"}${signal ? ` (signal ${signal})` : ""}`;
      const ok = code === 0;
      resolve({
        content: summary,
        data: { exitCode: code, signal, stdout: outRed, stderr: errRed },
        error: ok ? undefined : `command failed with exit code ${code ?? "?"}`,
      });
    });
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* noop */
      }
    }, DEFAULT_TIMEOUT_MS);

    function cleanup(): void {
      clearTimeout(timer);
      ctx.signal.removeEventListener("abort", onAbort);
    }
  });
}
