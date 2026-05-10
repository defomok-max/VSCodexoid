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

export const semanticSearchTool: ToolDefinition<{
  query: string;
  k?: number;
  filePattern?: string;
}> = {
  id: "semantic_search",
  name: "semantic_search",
  description:
    "Find code snippets by *meaning* rather than literal tokens. Embeds the query with the configured embeddings provider and returns the top-k matching chunks (file, line range, score, snippet). Falls back gracefully when the semantic index is disabled or no embeddings provider is configured. Pair with 'lexical_search' for keyword recall.",
  category: "search",
  riskLevel: "safe",
  schema: z.object({
    query: z.string().min(1).max(2000),
    k: z.number().int().min(1).max(50).optional(),
    filePattern: z.string().min(1).max(200).optional(),
  }),
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Natural-language description of what you're looking for." },
      k: { type: "integer", minimum: 1, maximum: 50, description: "Number of results (default 10)." },
      filePattern: {
        type: "string",
        description: "Case-insensitive substring filter on file paths (e.g. 'src/core/agent').",
      },
    },
    required: ["query"],
  },
  async execute(args, ctx) {
    if (!ctx.index || typeof ctx.index.semanticSearch !== "function") {
      return {
        content: "",
        error:
          "semantic search is not available — enable 'nexus.enableSemanticIndex' and configure an embeddings provider (nexus.embeddingProvider + nexus.embeddingModel).",
      };
    }
    const k = args.k ?? 10;
    const hits = await ctx.index.semanticSearch(args.query, {
      k,
      filePattern: args.filePattern,
      signal: ctx.signal,
    });
    if (hits.length === 0) {
      return { content: `no semantic matches for ${JSON.stringify(args.query)}`, data: [] };
    }
    const lines = hits.map((h) => {
      const sym = h.symbolName ? ` (${h.symbolKind ?? "symbol"} ${h.symbolName})` : "";
      const head = `${h.filePath}:${h.startLine}-${h.endLine}\tscore=${h.score.toFixed(3)}${sym}`;
      return `${head}\n${h.snippet}`;
    });
    return { content: lines.join("\n\n"), data: hits };
  },
};

export const refreshSemanticIndexTool: ToolDefinition<{ force?: boolean }> = {
  id: "refresh_semantic_index",
  name: "refresh_semantic_index",
  description:
    "(Re)build the semantic index. Walks the workspace, chunks every supported file, embeds new/changed chunks, and persists the vector store. Pass force=true to ignore the on-disk snapshot and rebuild from scratch.",
  category: "search",
  riskLevel: "low",
  schema: z.object({ force: z.boolean().optional() }),
  parameters: {
    type: "object",
    properties: { force: { type: "boolean" } },
    additionalProperties: false,
  },
  async execute(args, ctx) {
    if (!ctx.index || typeof ctx.index.refreshSemantic !== "function") {
      return {
        content: "",
        error:
          "semantic index is not available — enable 'nexus.enableSemanticIndex' and configure an embeddings provider.",
      };
    }
    const stats = await ctx.index.refreshSemantic({ force: args.force, signal: ctx.signal });
    return {
      content: `semantic index: ${stats.files} files, ${stats.chunks} chunks (${stats.model}, dim=${stats.dimensions ?? "?"})`,
      data: stats,
    };
  },
};
