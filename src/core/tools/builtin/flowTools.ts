import * as fs from "node:fs/promises";
import { z } from "zod";
import type { ToolContext, ToolDefinition, ToolTodoItem } from "../toolTypes";

const MAX_TODO_ITEMS = 64;
const MAX_TODO_TEXT = 240;
const MAX_DIFF_BYTES = 256 * 1024;
const MAX_QUEUE_TEXT = 8 * 1024;
const MAX_SUMMARY_BYTES = 16 * 1024;

const TodoStatus = z.enum(["pending", "in_progress", "completed", "blocked"]);

export const askUserTool: ToolDefinition<{ question: string }> = {
  id: "ask_user",
  name: "ask_user",
  description:
    "Asks the human a free-form clarifying question and returns their answer. Use sparingly — most decisions can be made from context.",
  category: "ui",
  riskLevel: "low",
  schema: z.object({ question: z.string().min(1).max(2000) }),
  parameters: {
    type: "object",
    properties: {
      question: { type: "string", description: "The question shown to the user." },
    },
    required: ["question"],
  },
  async execute(args, ctx) {
    const answer = await ctx.ui.askUser(args.question);
    if (answer === undefined) {
      return { content: "(user dismissed the prompt)", cancelled: true };
    }
    return { content: answer };
  },
};

export const showDiffTool: ToolDefinition<{
  path: string;
  before?: string;
  after: string;
  beforePath?: string;
  afterPath?: string;
}> = {
  id: "show_diff",
  name: "show_diff",
  description:
    "Surfaces a proposed diff in the diff panel WITHOUT applying it. Either pass `before` and `after` strings, or `beforePath`/`afterPath` to read existing files. Useful when the agent wants the user to confirm a multi-file plan before any write_file call.",
  category: "ui",
  riskLevel: "safe",
  schema: z
    .object({
      path: z.string().min(1),
      before: z.string().optional(),
      after: z.string(),
      beforePath: z.string().optional(),
      afterPath: z.string().optional(),
    }),
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Repository-relative path label for the diff hunk (e.g. 'src/foo.ts').",
      },
      before: {
        type: "string",
        description: "Previous content. If omitted, read from `beforePath`.",
      },
      after: { type: "string", description: "New content to compare against." },
      beforePath: {
        type: "string",
        description: "Workspace-relative path whose current contents become the 'before' side.",
      },
      afterPath: {
        type: "string",
        description: "Workspace-relative path whose current contents become the 'after' side.",
      },
    },
    required: ["path", "after"],
  },
  async execute(args, ctx) {
    const before = await resolveContent(ctx, args.before, args.beforePath);
    if ("error" in before) return { content: "", error: before.error };
    const afterText =
      args.afterPath !== undefined ? await readBounded(ctx, args.afterPath) : { text: args.after };
    if ("error" in afterText) return { content: "", error: afterText.error };
    if (Buffer.byteLength(before.text, "utf8") + Buffer.byteLength(afterText.text, "utf8") > MAX_DIFF_BYTES) {
      return { content: "", error: `combined diff exceeds ${MAX_DIFF_BYTES} bytes` };
    }
    return {
      content: `proposed diff for ${args.path} (${Buffer.byteLength(before.text, "utf8")}b -> ${Buffer.byteLength(afterText.text, "utf8")}b)`,
      diff: { files: [{ path: args.path, before: before.text, after: afterText.text }] },
    };
  },
};

export const updateTodoListTool: ToolDefinition<{ items: ToolTodoItem[] }> = {
  id: "update_todo_list",
  name: "update_todo_list",
  description:
    "Replaces the current task's todo checklist. Pass an `items[]` array; each item has `id`, `text`, and `status` ('pending' | 'in_progress' | 'completed' | 'blocked'). Use this to keep the user informed about multi-step plans.",
  category: "todo",
  riskLevel: "safe",
  schema: z.object({
    items: z
      .array(
        z.object({
          id: z.string().min(1),
          text: z.string().min(1).max(MAX_TODO_TEXT),
          status: TodoStatus,
        }),
      )
      .max(MAX_TODO_ITEMS),
  }),
  parameters: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            text: { type: "string" },
            status: { type: "string", enum: ["pending", "in_progress", "completed", "blocked"] },
          },
          required: ["id", "text", "status"],
        },
      },
    },
    required: ["items"],
  },
  async execute(args, ctx) {
    if (!ctx.taskId) {
      return { content: "", error: "no active task" };
    }
    ctx.flow.setTodo(ctx.taskId, args.items);
    const counts = countByStatus(args.items);
    return {
      content: `updated todo list: ${args.items.length} item(s) (${counts.in_progress} in progress, ${counts.completed} completed${
        counts.blocked > 0 ? `, ${counts.blocked} blocked` : ""
      })`,
      data: { count: args.items.length, byStatus: counts },
    };
  },
};

export const queueMessageTool: ToolDefinition<{
  text: string;
  priority?: number;
  modeOverride?: string;
  providerOverride?: string;
  modelOverride?: string;
}> = {
  id: "queue_message",
  name: "queue_message",
  description:
    "Adds a message to the user's queue so it's processed in a subsequent agent turn. Use this when you discover work that should be deferred (e.g., 'remember to add tests after this lands').",
  category: "todo",
  riskLevel: "low",
  schema: z.object({
    text: z.string().min(1).max(MAX_QUEUE_TEXT),
    priority: z.number().int().min(0).max(10).optional(),
    modeOverride: z.string().optional(),
    providerOverride: z.string().optional(),
    modelOverride: z.string().optional(),
  }),
  parameters: {
    type: "object",
    properties: {
      text: { type: "string", description: "Queued user prompt." },
      priority: {
        type: "integer",
        description: "Priority 0-10 (higher = sooner). Default 0.",
        minimum: 0,
        maximum: 10,
      },
      modeOverride: { type: "string" },
      providerOverride: { type: "string" },
      modelOverride: { type: "string" },
    },
    required: ["text"],
  },
  async execute(args, ctx) {
    const item = ctx.flow.enqueue({
      text: args.text,
      priority: args.priority ?? 0,
      modeOverride: args.modeOverride,
      providerOverride: args.providerOverride,
      modelOverride: args.modelOverride,
    });
    return {
      content: `queued message ${item.id} at priority ${args.priority ?? 0}`,
      data: { id: item.id, createdAt: item.createdAt },
    };
  },
};

export const summarizeSessionTool: ToolDefinition<{ summary: string }> = {
  id: "summarize_session",
  name: "summarize_session",
  description:
    "Records a final summary on the current task. Use at the end of a multi-turn task to capture what changed, why, and any open follow-ups.",
  category: "ui",
  riskLevel: "safe",
  schema: z.object({ summary: z.string().min(1).max(MAX_SUMMARY_BYTES) }),
  parameters: {
    type: "object",
    properties: {
      summary: { type: "string", description: "Markdown summary of the session." },
    },
    required: ["summary"],
  },
  async execute(args, ctx) {
    if (!ctx.taskId) {
      return { content: "", error: "no active task" };
    }
    ctx.flow.recordSummary(ctx.taskId, args.summary);
    return {
      content: `recorded session summary (${args.summary.length} chars)`,
      data: { length: args.summary.length },
    };
  },
};

async function resolveContent(
  ctx: ToolContext,
  inline: string | undefined,
  fromPath: string | undefined,
): Promise<{ text: string } | { error: string }> {
  if (inline !== undefined) return { text: inline };
  if (fromPath !== undefined) return readBounded(ctx, fromPath);
  return { text: "" };
}

async function readBounded(
  ctx: ToolContext,
  rel: string,
): Promise<{ text: string } | { error: string }> {
  let abs: string;
  try {
    abs = ctx.security.resolveWorkspacePath(rel);
  } catch (e) {
    return { error: (e as Error).message };
  }
  if (ctx.security.isIgnored(abs)) {
    return { error: `path "${rel}" is ignored by .nexusignore` };
  }
  try {
    const buf = await fs.readFile(abs);
    if (buf.length > MAX_DIFF_BYTES) {
      return { error: `"${rel}" exceeds ${MAX_DIFF_BYTES} bytes` };
    }
    return { text: buf.toString("utf8") };
  } catch (e) {
    return { error: `cannot read "${rel}": ${(e as Error).message}` };
  }
}

function countByStatus(items: ToolTodoItem[]): {
  pending: number;
  in_progress: number;
  completed: number;
  blocked: number;
} {
  const c = { pending: 0, in_progress: 0, completed: 0, blocked: 0 };
  for (const item of items) c[item.status]++;
  return c;
}
