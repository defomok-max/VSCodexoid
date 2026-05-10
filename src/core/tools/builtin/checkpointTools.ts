import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import type { CheckpointInfo, ToolContext, ToolDefinition } from "../toolTypes";

const MAX_PATHS_PER_CHECKPOINT = 200;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_LIST_ENTRIES = 25;

export const createCheckpointTool: ToolDefinition<{
  label?: string;
  paths?: string[];
}> = {
  id: "create_checkpoint",
  name: "create_checkpoint",
  description:
    "Snapshots the listed files (workspace-relative paths) so the user can roll back the next change. Returns the new checkpoint id.",
  category: "checkpoint",
  riskLevel: "safe",
  schema: z.object({
    label: z.string().optional(),
    paths: z.array(z.string()).max(MAX_PATHS_PER_CHECKPOINT).optional(),
  }),
  parameters: {
    type: "object",
    properties: {
      label: { type: "string", description: "Human-readable label for this checkpoint." },
      paths: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional list of workspace-relative file paths to snapshot. Omit for a label-only marker (no files captured).",
      },
    },
  },
  async execute(args, ctx) {
    const captured = await loadFiles(ctx, args.paths ?? []);
    if ("error" in captured) {
      return { content: "", error: captured.error };
    }
    const meta = await ctx.checkpoints.create(args.label, ctx.taskId, captured.files);
    const totalBytes = captured.files.reduce(
      (sum, f) => sum + Buffer.byteLength(f.content, "utf8"),
      0,
    );
    const summary = `checkpoint ${meta.id} created: ${captured.files.length} file(s), ${totalBytes} byte(s)${
      args.label ? ` ("${args.label}")` : ""
    }`;
    return { content: summary, data: meta };
  },
};

export const listCheckpointsTool: ToolDefinition<{ limit?: number }> = {
  id: "list_checkpoints",
  name: "list_checkpoints",
  description:
    "Returns recent checkpoints (newest first) so the agent can reason about what to roll back.",
  category: "checkpoint",
  riskLevel: "safe",
  schema: z.object({ limit: z.number().int().min(1).max(MAX_LIST_ENTRIES).optional() }),
  parameters: {
    type: "object",
    properties: {
      limit: {
        type: "integer",
        description: `How many entries to return (default 10, max ${MAX_LIST_ENTRIES}).`,
      },
    },
  },
  async execute(args, ctx) {
    const all = ctx.checkpoints.list();
    const limit = args.limit ?? 10;
    const trimmed = all.slice(0, limit);
    if (trimmed.length === 0) {
      return { content: "(no checkpoints yet)", data: [] };
    }
    const lines = trimmed.map(formatCheckpoint);
    return { content: lines.join("\n"), data: trimmed };
  },
};

export const restoreCheckpointTool: ToolDefinition<{ id: string }> = {
  id: "restore_checkpoint",
  name: "restore_checkpoint",
  description:
    "Restores all files in a checkpoint to the workspace, overwriting current contents. Destructive — needs approval.",
  category: "checkpoint",
  riskLevel: "high",
  schema: z.object({ id: z.string() }),
  parameters: {
    type: "object",
    properties: {
      id: { type: "string", description: "Checkpoint id (from create_checkpoint or list_checkpoints)." },
    },
    required: ["id"],
  },
  async execute(args, ctx) {
    if (!ctx.workspaceRoot) {
      return { content: "", error: "no workspace root — cannot restore checkpoint" };
    }
    const all = ctx.checkpoints.list();
    const meta = all.find((c) => c.id === args.id);
    if (!meta) {
      return { content: "", error: `checkpoint ${args.id} not found` };
    }
    const blocked = meta.files.find((f) =>
      ctx.security.isIgnored(ctx.security.resolveWorkspacePath(f.path)),
    );
    if (blocked) {
      return {
        content: "",
        error: `checkpoint ${args.id} would write ignored path "${blocked.path}" — refusing`,
      };
    }
    const n = await ctx.checkpoints.restore(args.id, ctx.workspaceRoot);
    return {
      content: `restored ${n} file(s) from checkpoint ${args.id}${meta.label ? ` ("${meta.label}")` : ""}`,
      data: { ...meta, filesRestored: n },
    };
  },
};

export const rollbackCheckpointTool: ToolDefinition<Record<string, never>> = {
  id: "rollback_checkpoint",
  name: "rollback_checkpoint",
  description:
    "Rolls back to the most recent checkpoint by restoring it to disk. Destructive — needs approval.",
  category: "checkpoint",
  riskLevel: "high",
  schema: z.object({}).strict(),
  parameters: { type: "object", properties: {}, additionalProperties: false },
  async execute(_args, ctx) {
    if (!ctx.workspaceRoot) {
      return { content: "", error: "no workspace root — cannot rollback" };
    }
    const all = ctx.checkpoints.list();
    if (all.length === 0) {
      return { content: "", error: "no checkpoints to roll back to" };
    }
    const latest = all[0];
    const blocked = latest.files.find((f) =>
      ctx.security.isIgnored(ctx.security.resolveWorkspacePath(f.path)),
    );
    if (blocked) {
      return {
        content: "",
        error: `latest checkpoint would write ignored path "${blocked.path}" — refusing`,
      };
    }
    const n = await ctx.checkpoints.restore(latest.id, ctx.workspaceRoot);
    return {
      content: `rolled back to ${latest.id}${latest.label ? ` ("${latest.label}")` : ""} — restored ${n} file(s)`,
      data: { ...latest, filesRestored: n },
    };
  },
};

async function loadFiles(
  ctx: ToolContext,
  rels: string[],
): Promise<{ files: { path: string; content: string }[] } | { error: string }> {
  const out: { path: string; content: string }[] = [];
  for (const rel of rels) {
    let abs: string;
    try {
      abs = ctx.security.resolveWorkspacePath(rel);
    } catch (e) {
      return { error: (e as Error).message };
    }
    if (ctx.security.isIgnored(abs)) {
      return { error: `path "${rel}" is ignored by .nexusignore` };
    }
    let buf: Buffer;
    try {
      buf = await fs.readFile(abs);
    } catch (e) {
      return { error: `cannot read "${rel}": ${(e as Error).message}` };
    }
    if (buf.length > MAX_FILE_BYTES) {
      return { error: `"${rel}" is larger than ${MAX_FILE_BYTES} bytes — too big to checkpoint` };
    }
    const text = buf.toString("utf8");
    if (text.includes("\u0000")) {
      return { error: `"${rel}" looks binary — refusing to checkpoint` };
    }
    const norm = path.relative(ctx.workspaceRoot ?? path.dirname(abs), abs).replace(/\\/g, "/");
    out.push({ path: norm || rel, content: text });
  }
  return { files: out };
}

function formatCheckpoint(c: CheckpointInfo): string {
  const totalBytes = c.files.reduce((sum, f) => sum + f.bytes, 0);
  const date = new Date(c.createdAt).toISOString();
  return `${c.id} ${date} ${c.files.length}f/${totalBytes}b${c.label ? ` "${c.label}"` : ""}`;
}
