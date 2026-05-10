import { spawn } from "node:child_process";
import { z } from "zod";
import { assessCommandRisk } from "../../approval/approvalManager";
import type { ToolDefinition } from "../toolTypes";
import { recordTerminalOutput } from "./terminalCapture";

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_OUTPUT = 64 * 1024;

export const runTerminalCommandTool: ToolDefinition<{
  command: string;
  cwd?: string;
  timeoutMs?: number;
}> = {
  id: "run_terminal_command",
  name: "run_terminal_command",
  description:
    "Run a shell command. Use only when needed; risk is assessed dynamically (rm -rf, sudo, etc. are blocked).",
  category: "shell",
  riskLevel: "high",
  schema: z.object({
    command: z.string(),
    cwd: z.string().optional(),
    timeoutMs: z.number().int().min(1000).max(300_000).optional(),
  }),
  parameters: {
    type: "object",
    properties: {
      command: { type: "string" },
      cwd: { type: "string" },
      timeoutMs: { type: "integer" },
    },
    required: ["command"],
  },
  assessRisk(args) {
    return assessCommandRisk(args.command).risk;
  },
  async execute(args, ctx) {
    const cwd = args.cwd ? ctx.security.resolveWorkspacePath(args.cwd) : ctx.workspaceRoot;
    const timeout = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    return new Promise<Awaited<ReturnType<NonNullable<ToolDefinition["execute"]>>>>((resolve) => {
      const child = spawn(args.command, {
        cwd,
        shell: true,
        env: process.env,
      });
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

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
        if (stdout.length > MAX_OUTPUT) stdout = stdout.slice(-MAX_OUTPUT);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
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
          command: args.command,
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
        resolve({ content: summary, data: { exitCode: code, signal, stdout: outRed, stderr: errRed } });
      });
      const timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* noop */
        }
      }, timeout);

      function cleanup() {
        clearTimeout(timer);
        ctx.signal.removeEventListener("abort", onAbort);
      }
    });
  },
};
