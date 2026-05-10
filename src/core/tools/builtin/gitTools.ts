import { spawn } from "node:child_process";
import { z } from "zod";
import type { ToolDefinition } from "../toolTypes";

const MAX_BUF = 256 * 1024;

function git(cwd: string, args: string[], signal: AbortSignal): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("git", args, { cwd });
    let stdout = "";
    let stderr = "";
    const onAbort = () => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* noop */
      }
    };
    signal.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (b: Buffer) => {
      stdout += b.toString("utf8");
      if (stdout.length > MAX_BUF) stdout = stdout.slice(-MAX_BUF);
    });
    child.stderr.on("data", (b: Buffer) => {
      stderr += b.toString("utf8");
      if (stderr.length > MAX_BUF) stderr = stderr.slice(-MAX_BUF);
    });
    child.on("close", (code) => {
      signal.removeEventListener("abort", onAbort);
      resolve({ code, stdout, stderr });
    });
    child.on("error", (e) => {
      signal.removeEventListener("abort", onAbort);
      resolve({ code: 1, stdout: "", stderr: e.message });
    });
  });
}

export const gitStatusTool: ToolDefinition<Record<string, never>> = {
  id: "get_git_status",
  name: "get_git_status",
  description: "Show `git status --porcelain=v1 -b` summary.",
  category: "git",
  riskLevel: "safe",
  schema: z.object({}),
  parameters: { type: "object", properties: {} },
  async execute(_args, ctx) {
    if (!ctx.workspaceRoot) return { content: "", error: "no workspace open" };
    const r = await git(ctx.workspaceRoot, ["status", "--porcelain=v1", "-b"], ctx.signal);
    return { content: r.stdout, data: r };
  },
};

export const gitDiffTool: ToolDefinition<{ ref?: string; staged?: boolean }> = {
  id: "get_git_diff",
  name: "get_git_diff",
  description: "Run `git diff` (optionally against a ref or with --staged).",
  category: "git",
  riskLevel: "safe",
  schema: z.object({ ref: z.string().optional(), staged: z.boolean().optional() }),
  parameters: {
    type: "object",
    properties: { ref: { type: "string" }, staged: { type: "boolean" } },
  },
  async execute(args, ctx) {
    if (!ctx.workspaceRoot) return { content: "", error: "no workspace open" };
    const argv = ["diff"];
    if (args.staged) argv.push("--staged");
    if (args.ref) argv.push(args.ref);
    const r = await git(ctx.workspaceRoot, argv, ctx.signal);
    const { redacted } = ctx.security.scanSecrets(r.stdout);
    return { content: redacted, data: { exitCode: r.code } };
  },
};

export const gitCreateBranchTool: ToolDefinition<{ name: string }> = {
  id: "create_git_branch",
  name: "create_git_branch",
  description: "Create and switch to a new branch.",
  category: "git",
  riskLevel: "low",
  schema: z.object({ name: z.string().min(1) }),
  parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
  async execute(args, ctx) {
    if (!ctx.workspaceRoot) return { content: "", error: "no workspace open" };
    const r = await git(ctx.workspaceRoot, ["checkout", "-b", args.name], ctx.signal);
    if (r.code !== 0) return { content: "", error: r.stderr };
    return { content: `Created and checked out branch ${args.name}.` };
  },
};

export const gitStageTool: ToolDefinition<{ paths: string[] }> = {
  id: "stage_files",
  name: "stage_files",
  description: "Stage one or more files via `git add`.",
  category: "git",
  riskLevel: "low",
  schema: z.object({ paths: z.array(z.string()).min(1) }),
  parameters: {
    type: "object",
    properties: { paths: { type: "array", items: { type: "string" } } },
    required: ["paths"],
  },
  async execute(args, ctx) {
    if (!ctx.workspaceRoot) return { content: "", error: "no workspace open" };
    const r = await git(ctx.workspaceRoot, ["add", "--", ...args.paths], ctx.signal);
    if (r.code !== 0) return { content: "", error: r.stderr };
    return { content: `Staged ${args.paths.length} path(s).` };
  },
};

export const gitCommitTool: ToolDefinition<{ message: string }> = {
  id: "commit_changes",
  name: "commit_changes",
  description: "Commit staged changes. The user's git config is used for author info.",
  category: "git",
  riskLevel: "medium",
  schema: z.object({ message: z.string().min(1) }),
  parameters: {
    type: "object",
    properties: { message: { type: "string" } },
    required: ["message"],
  },
  async execute(args, ctx) {
    if (!ctx.workspaceRoot) return { content: "", error: "no workspace open" };
    const r = await git(ctx.workspaceRoot, ["commit", "-m", args.message], ctx.signal);
    if (r.code !== 0) return { content: r.stdout, error: r.stderr };
    return { content: r.stdout };
  },
};
