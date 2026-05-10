import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import type { ToolDefinition } from "../toolTypes";
import { buildDiffPreview } from "../../edit/patchEngine";

const MAX_BYTES = 256 * 1024;

export const readFileTool: ToolDefinition<{ path: string; startLine?: number; endLine?: number }> = {
  id: "read_file",
  name: "read_file",
  description:
    "Read a UTF-8 text file from the workspace. Returns up to 256 KB of content; use startLine/endLine to slice.",
  category: "read",
  riskLevel: "safe",
  schema: z.object({
    path: z.string(),
    startLine: z.number().int().min(1).optional(),
    endLine: z.number().int().min(1).optional(),
  }),
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Workspace-relative or absolute path" },
      startLine: { type: "integer", description: "1-based start line (optional)" },
      endLine: { type: "integer", description: "1-based end line (optional)" },
    },
    required: ["path"],
  },
  async execute(args, ctx) {
    const abs = ctx.security.resolveWorkspacePath(args.path);
    if (ctx.security.isIgnored(abs)) {
      return { content: "", error: `path "${args.path}" is ignored by .nexusignore` };
    }
    const stat = await fs.stat(abs);
    if (!stat.isFile()) return { content: "", error: `not a file: ${args.path}` };
    if (stat.size > MAX_BYTES) {
      const fh = await fs.open(abs, "r");
      try {
        const buf = Buffer.alloc(MAX_BYTES);
        await fh.read(buf, 0, MAX_BYTES, 0);
        const partial = buf.toString("utf8");
        const { redacted } = ctx.security.scanSecrets(partial);
        return {
          content: `(truncated to ${MAX_BYTES} bytes of ${stat.size})\n${redacted}`,
        };
      } finally {
        await fh.close();
      }
    }
    let text = await fs.readFile(abs, "utf8");
    if (args.startLine || args.endLine) {
      const lines = text.split("\n");
      const start = (args.startLine ?? 1) - 1;
      const end = args.endLine ?? lines.length;
      text = lines.slice(start, end).join("\n");
    }
    const { redacted } = ctx.security.scanSecrets(text);
    return { content: redacted };
  },
};

export const listFilesTool: ToolDefinition<{ path: string; recursive?: boolean; maxResults?: number }> = {
  id: "list_files",
  name: "list_files",
  description: "List directory contents. Returns relative paths. Honors .nexusignore.",
  category: "read",
  riskLevel: "safe",
  schema: z.object({
    path: z.string(),
    recursive: z.boolean().optional(),
    maxResults: z.number().int().min(1).max(2000).optional(),
  }),
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", default: "." },
      recursive: { type: "boolean" },
      maxResults: { type: "integer" },
    },
  },
  async execute(args, ctx) {
    const root = ctx.security.resolveWorkspacePath(args.path ?? ".");
    const max = args.maxResults ?? 500;
    const out: string[] = [];
    const stack: string[] = [root];
    while (stack.length > 0 && out.length < max) {
      const cur = stack.pop()!;
      let entries;
      try {
        entries = await fs.readdir(cur, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        const abs = path.join(cur, e.name);
        if (ctx.security.isIgnored(abs)) continue;
        const rel = path.relative(ctx.workspaceRoot ?? root, abs);
        out.push(e.isDirectory() ? rel + "/" : rel);
        if (out.length >= max) break;
        if (args.recursive && e.isDirectory()) stack.push(abs);
      }
    }
    out.sort();
    return { content: out.join("\n"), data: out };
  },
};

const editFileSchema = z.object({
  path: z.string(),
  content: z.string(),
});

export const writeFileTool: ToolDefinition<{ path: string; content: string }> = {
  id: "write_file",
  name: "write_file",
  description: "Replace the entire contents of a file. Produces a diff preview for approval.",
  category: "edit",
  riskLevel: "medium",
  producesDiff: true,
  schema: editFileSchema,
  parameters: {
    type: "object",
    properties: { path: { type: "string" }, content: { type: "string" } },
    required: ["path", "content"],
  },
  async execute(args, ctx) {
    const abs = ctx.security.resolveWorkspacePath(args.path);
    if (ctx.security.isIgnored(abs)) {
      return { content: "", error: `path "${args.path}" is ignored by .nexusignore` };
    }
    let before = "";
    try {
      before = await fs.readFile(abs, "utf8");
    } catch {
      // new file
    }
    const diff = buildDiffPreview(args.path, before, args.content);
    return {
      content: `Diff prepared for ${args.path} (${diff.hunks.length} hunks). Awaiting approval.`,
      diff: { files: [{ path: args.path, before, after: args.content }] },
    };
  },
};

export const editFileTool: ToolDefinition<{ path: string; oldText: string; newText: string }> = {
  id: "edit_file",
  name: "edit_file",
  description:
    "Replace `oldText` with `newText` in a file. The `oldText` must match exactly once. Produces a diff preview for approval.",
  category: "edit",
  riskLevel: "medium",
  producesDiff: true,
  schema: z.object({ path: z.string(), oldText: z.string(), newText: z.string() }),
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      oldText: { type: "string" },
      newText: { type: "string" },
    },
    required: ["path", "oldText", "newText"],
  },
  async execute(args, ctx) {
    const abs = ctx.security.resolveWorkspacePath(args.path);
    if (ctx.security.isIgnored(abs)) {
      return { content: "", error: `path "${args.path}" is ignored by .nexusignore` };
    }
    let before: string;
    try {
      before = await fs.readFile(abs, "utf8");
    } catch (e) {
      return { content: "", error: `cannot read ${args.path}: ${(e as Error).message}` };
    }
    const occurrences = countOccurrences(before, args.oldText);
    if (occurrences === 0) {
      return { content: "", error: `oldText not found in ${args.path}` };
    }
    if (occurrences > 1) {
      return {
        content: "",
        error: `oldText is ambiguous in ${args.path} (${occurrences} matches) — include more context`,
      };
    }
    const after = before.replace(args.oldText, args.newText);
    return {
      content: `Diff prepared for ${args.path}. Awaiting approval.`,
      diff: { files: [{ path: args.path, before, after }] },
    };
  },
};

export const createFileTool: ToolDefinition<{ path: string; content: string }> = {
  id: "create_file",
  name: "create_file",
  description: "Create a new file. Errors if the file already exists.",
  category: "edit",
  riskLevel: "low",
  producesDiff: true,
  schema: editFileSchema,
  parameters: {
    type: "object",
    properties: { path: { type: "string" }, content: { type: "string" } },
    required: ["path", "content"],
  },
  async execute(args, ctx) {
    const abs = ctx.security.resolveWorkspacePath(args.path);
    if (ctx.security.isIgnored(abs)) {
      return { content: "", error: `path "${args.path}" is ignored by .nexusignore` };
    }
    try {
      await fs.access(abs);
      return { content: "", error: `file ${args.path} already exists` };
    } catch {
      // expected
    }
    return {
      content: `New file ready: ${args.path}. Awaiting approval.`,
      diff: { files: [{ path: args.path, before: "", after: args.content }] },
    };
  },
};

export const deleteFileTool: ToolDefinition<{ path: string }> = {
  id: "delete_file",
  name: "delete_file",
  description: "Delete a file. High risk — always requires approval under default policies.",
  category: "edit",
  riskLevel: "high",
  schema: z.object({ path: z.string() }),
  parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  async execute(args, ctx) {
    const abs = ctx.security.resolveWorkspacePath(args.path);
    if (ctx.security.isIgnored(abs)) {
      return { content: "", error: `path "${args.path}" is ignored by .nexusignore` };
    }
    await fs.unlink(abs);
    return { content: `Deleted ${args.path}.` };
  },
};

export const renameFileTool: ToolDefinition<{ from: string; to: string }> = {
  id: "rename_file",
  name: "rename_file",
  description: "Rename or move a file inside the workspace.",
  category: "edit",
  riskLevel: "medium",
  schema: z.object({ from: z.string(), to: z.string() }),
  parameters: {
    type: "object",
    properties: { from: { type: "string" }, to: { type: "string" } },
    required: ["from", "to"],
  },
  async execute(args, ctx) {
    const fromAbs = ctx.security.resolveWorkspacePath(args.from);
    const toAbs = ctx.security.resolveWorkspacePath(args.to);
    if (ctx.security.isIgnored(fromAbs) || ctx.security.isIgnored(toAbs)) {
      return { content: "", error: "either source or destination is ignored by .nexusignore" };
    }
    await fs.rename(fromAbs, toAbs);
    return { content: `Renamed ${args.from} -> ${args.to}.` };
  },
};

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    n++;
    idx += needle.length;
  }
  return n;
}
