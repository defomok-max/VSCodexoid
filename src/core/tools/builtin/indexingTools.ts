import { z } from "zod";
import type { ToolDefinition } from "../toolTypes";

const SYMBOL_KINDS = [
  "function",
  "class",
  "interface",
  "type",
  "enum",
  "namespace",
  "const",
  "let",
  "method",
] as const;

export const findSymbolTool: ToolDefinition<{
  name: string;
  kind?: (typeof SYMBOL_KINDS)[number];
  regex?: boolean;
  maxResults?: number;
}> = {
  id: "find_symbol",
  name: "find_symbol",
  description:
    "Find symbol declarations (functions, classes, types, methods, …) by name in the workspace index. Use 'refresh_index' if results look stale.",
  category: "search",
  riskLevel: "safe",
  schema: z.object({
    name: z.string().min(1).max(200),
    kind: z.enum(SYMBOL_KINDS).optional(),
    regex: z.boolean().optional(),
    maxResults: z.number().int().min(1).max(500).optional(),
  }),
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Substring or regex to match against symbol names." },
      kind: { type: "string", enum: [...SYMBOL_KINDS] },
      regex: { type: "boolean", description: "Treat 'name' as a JS regex (case-insensitive)." },
      maxResults: { type: "integer", minimum: 1, maximum: 500 },
    },
    required: ["name"],
  },
  async execute(args, ctx) {
    if (!ctx.index) {
      return { content: "", error: "workspace index not available in this context" };
    }
    const stats = ctx.index.stats();
    if (stats.files === 0) {
      await ctx.index.refresh();
    }
    const hits = ctx.index.findSymbol(args.name, {
      kind: args.kind,
      regex: args.regex,
      maxResults: args.maxResults,
    });
    if (hits.length === 0) {
      return { content: `no symbols matching ${JSON.stringify(args.name)}`, data: [] };
    }
    const lines = hits.map((h) => {
      const tag = h.exported ? " (exported)" : "";
      const container = h.container ? `${h.container}.` : "";
      return `${h.file}:${h.line}: ${h.kind} ${container}${h.name}${tag}`;
    });
    return { content: lines.join("\n"), data: hits };
  },
};

export const lexicalSearchTool: ToolDefinition<{ query: string; maxResults?: number }> = {
  id: "lexical_search",
  name: "lexical_search",
  description:
    "Rank workspace files by lexical relevance to the query (TF·IDF over the in-memory index). Faster than 'grep' on large repos and returns whole-file relevance scores rather than line matches.",
  category: "search",
  riskLevel: "safe",
  schema: z.object({
    query: z.string().min(1).max(2000),
    maxResults: z.number().int().min(1).max(200).optional(),
  }),
  parameters: {
    type: "object",
    properties: {
      query: { type: "string" },
      maxResults: { type: "integer", minimum: 1, maximum: 200 },
    },
    required: ["query"],
  },
  async execute(args, ctx) {
    if (!ctx.index) {
      return { content: "", error: "workspace index not available in this context" };
    }
    const stats = ctx.index.stats();
    if (stats.files === 0) {
      await ctx.index.refresh();
    }
    const hits = ctx.index.lexicalSearch(args.query, { maxResults: args.maxResults ?? 25 });
    if (hits.length === 0) {
      return { content: `no files matching ${JSON.stringify(args.query)}`, data: [] };
    }
    const formatted = hits.map((h) => `${h.path}\t${h.score.toFixed(3)}`).join("\n");
    return { content: formatted, data: hits };
  },
};

export const refreshIndexTool: ToolDefinition<Record<string, never>> = {
  id: "refresh_index",
  name: "refresh_index",
  description:
    "Re-scan the workspace and refresh the symbol/lexical index. Returns the new index size. Cheap on warm caches (skips unchanged files).",
  category: "search",
  riskLevel: "safe",
  schema: z.object({}).strict(),
  parameters: { type: "object", properties: {}, additionalProperties: false },
  async execute(_args, ctx) {
    if (!ctx.index) {
      return { content: "", error: "workspace index not available in this context" };
    }
    const stats = await ctx.index.refresh();
    return {
      content: `index: ${stats.files} files, ${stats.symbols} symbols, ${stats.uniqueTerms} unique terms, ${stats.bytesIndexed} bytes`,
      data: stats,
    };
  },
};
