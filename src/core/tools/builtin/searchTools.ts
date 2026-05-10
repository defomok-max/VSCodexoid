import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import type { ToolDefinition } from "../toolTypes";

const MAX_GREP_BYTES = 1 * 1024 * 1024;
const MAX_GREP_RESULTS = 500;

export const searchFilesTool: ToolDefinition<{ pattern: string; path?: string; maxResults?: number }> = {
  id: "search_files",
  name: "search_files",
  description: "Find files whose path matches a glob-like substring. Honors .nexusignore.",
  category: "search",
  riskLevel: "safe",
  schema: z.object({
    pattern: z.string(),
    path: z.string().optional(),
    maxResults: z.number().int().min(1).max(2000).optional(),
  }),
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string" },
      path: { type: "string" },
      maxResults: { type: "integer" },
    },
    required: ["pattern"],
  },
  async execute(args, ctx) {
    const root = ctx.security.resolveWorkspacePath(args.path ?? ".");
    const max = args.maxResults ?? 200;
    const needle = args.pattern.toLowerCase();
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
        if (e.isDirectory()) {
          stack.push(abs);
          continue;
        }
        if (rel.toLowerCase().includes(needle)) out.push(rel);
      }
    }
    out.sort();
    return { content: out.join("\n"), data: out };
  },
};

export const grepTool: ToolDefinition<{
  query: string;
  path?: string;
  regex?: boolean;
  caseInsensitive?: boolean;
  maxResults?: number;
  filePattern?: string;
}> = {
  id: "grep",
  name: "grep",
  description: "Search file contents for a query (literal or regex). Skips ignored paths and binary files.",
  category: "search",
  riskLevel: "safe",
  schema: z.object({
    query: z.string(),
    path: z.string().optional(),
    regex: z.boolean().optional(),
    caseInsensitive: z.boolean().optional(),
    maxResults: z.number().int().min(1).max(2000).optional(),
    filePattern: z.string().optional(),
  }),
  parameters: {
    type: "object",
    properties: {
      query: { type: "string" },
      path: { type: "string" },
      regex: { type: "boolean" },
      caseInsensitive: { type: "boolean" },
      maxResults: { type: "integer" },
      filePattern: { type: "string" },
    },
    required: ["query"],
  },
  async execute(args, ctx) {
    const root = ctx.security.resolveWorkspacePath(args.path ?? ".");
    const max = args.maxResults ?? MAX_GREP_RESULTS;
    const flags = args.caseInsensitive ? "gi" : "g";
    const re = args.regex
      ? new RegExp(args.query, flags)
      : new RegExp(args.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
    const fileNeedle = args.filePattern?.toLowerCase();
    const results: { file: string; line: number; text: string }[] = [];
    const stack: string[] = [root];
    while (stack.length > 0 && results.length < max) {
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
        if (e.isDirectory()) {
          stack.push(abs);
          continue;
        }
        const rel = path.relative(ctx.workspaceRoot ?? root, abs);
        if (fileNeedle && !rel.toLowerCase().includes(fileNeedle)) continue;
        let stat;
        try {
          stat = await fs.stat(abs);
        } catch {
          continue;
        }
        if (stat.size > MAX_GREP_BYTES) continue;
        let text;
        try {
          text = await fs.readFile(abs, "utf8");
        } catch {
          continue;
        }
        if (looksBinary(text)) continue;
        const lines = text.split("\n");
        for (let i = 0; i < lines.length && results.length < max; i++) {
          if (re.test(lines[i])) {
            results.push({ file: rel, line: i + 1, text: lines[i].slice(0, 400) });
            re.lastIndex = 0;
          }
        }
      }
    }
    const formatted = results.map((r) => `${r.file}:${r.line}: ${r.text}`).join("\n");
    return { content: formatted, data: results };
  },
};

function looksBinary(s: string): boolean {
  // Quick check: first 1KB containing NULs is treated as binary.
  const slice = s.slice(0, 1024);
  return slice.indexOf("\u0000") !== -1;
}
