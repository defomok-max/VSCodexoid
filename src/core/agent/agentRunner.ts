import type { ZodType } from "zod";
import type {
  ApprovalDecision,
  ApprovalPolicy,
  ApprovalRequest,
  ChatMessage as ChatMessageWebview,
  DiffPreviewFile,
  ModeProfile,
  RiskLevel,
  SkillDefinition,
  NexusSettings,
} from "../../shared/types";
import type { ChatRequest, ChatTool, LLMProvider } from "../providers/providerTypes";
import type {
  ToolDefinition,
  ToolContext,
  ToolUiBridge,
  ToolSecurityBridge,
  ToolCheckpointBridge,
  ToolFlowBridge,
} from "../tools/toolTypes";
import type { ToolRegistry } from "../tools/toolRegistry";
import { evaluateApproval } from "../approval/approvalManager";
import { buildDiffPreview } from "../edit/patchEngine";
import type { AgentEvent } from "./agentEvents";
import { buildLlmMessages, buildSystemPrompt } from "./promptBuilder";

export interface AgentRunOptions {
  taskId: string;
  prompt: string;
  transcript?: ChatMessageWebview[];
  contextChunksText?: string;
  mode: ModeProfile;
  matchedSkills: SkillDefinition[];
  rulesText?: string;
  settings: NexusSettings;
  provider: LLMProvider;
  apiKey?: string;
  modelId: string;
  policy: ApprovalPolicy;
}

export interface AgentRunDeps {
  toolRegistry: ToolRegistry;
  ui: ToolUiBridge;
  security: ToolSecurityBridge;
  checkpoints: ToolCheckpointBridge;
  flow: ToolFlowBridge;
  workspaceRoot: string | undefined;
  /** Awaits user decision for an approval request. Resolved by the host. */
  requestApproval: (req: ApprovalRequest) => Promise<ApprovalDecision>;
  /** Map of accepted file diffs from the previous turn (for context). */
  acceptedDiffs?: DiffPreviewFile[];
}

const MAX_ROUNDS = 8;

/**
 * Runs a single chat turn against the given provider.
 *
 *   1. Build system prompt + messages.
 *   2. Stream tokens from the provider.
 *   3. When the model emits a `tool_call_start`/`tool_call_args` pair, parse
 *      the args, validate against the tool's Zod schema, evaluate approval,
 *      execute the tool, and feed the result back as a `tool` message.
 *   4. Loop until the model finishes naturally or `MAX_ROUNDS` is reached.
 *
 * The runner yields `AgentEvent`s; the host adapts them to webview protocol
 * messages.
 */
export async function* runAgent(opts: AgentRunOptions, deps: AgentRunDeps, abort: AbortSignal): AsyncGenerator<AgentEvent> {
  yield { type: "task_start", taskId: opts.taskId };

  const allowedToolIds = filterTools(opts.mode, opts.matchedSkills, deps.toolRegistry.ids());
  const tools = deps.toolRegistry.list({ allowed: allowedToolIds });
  const toolDescriptors: ChatTool[] = tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));

  const systemPrompt = buildSystemPrompt({
    mode: opts.mode,
    skills: opts.matchedSkills,
    rulesText: opts.rulesText,
    settings: opts.settings,
    toolsSummary: summarizeTools(tools),
  });

  let messages: ChatMessageWebview[] = buildLlmMessages(
    systemPrompt,
    opts.transcript ?? [],
    opts.prompt,
    opts.contextChunksText,
  );

  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (abort.aborted) {
      yield { type: "task_end", taskId: opts.taskId, reason: "stopped" };
      return;
    }
    const req: ChatRequest = {
      model: opts.modelId,
      messages,
      tools: toolDescriptors,
      temperature: opts.mode.temperature,
      reasoningEffort: opts.mode.reasoningEffort,
      stream: true,
      signal: abort,
    };

    let assistantText = "";
    let reasoning = "";
    const toolCalls = new Map<string, { id: string; name?: string; args: string }>();
    let lastToolCallId: string | undefined;

    try {
      for await (const delta of opts.provider.stream(req, { apiKey: opts.apiKey })) {
        if (abort.aborted) break;
        if (delta.type === "text") {
          assistantText += delta.text;
          yield { type: "text_delta", text: delta.text };
        } else if (delta.type === "reasoning") {
          reasoning += delta.text;
          yield { type: "thinking", text: delta.text };
        } else if (delta.type === "tool_call_start") {
          toolCalls.set(delta.id, { id: delta.id, name: delta.name, args: "" });
          lastToolCallId = delta.id;
        } else if (delta.type === "tool_call_args") {
          const tc = toolCalls.get(delta.id) ?? toolCalls.get(lastToolCallId ?? "");
          if (tc) tc.args += delta.argsDelta;
        } else if (delta.type === "usage") {
          yield { type: "usage", inputTokens: delta.inputTokens, outputTokens: delta.outputTokens };
        } else if (delta.type === "error") {
          yield { type: "error", message: delta.message };
        }
      }
    } catch (e) {
      yield { type: "error", message: (e as Error).message };
      yield { type: "task_end", taskId: opts.taskId, reason: "failed" };
      return;
    }

    yield {
      type: "message_complete",
      messageId: makeMsgId(),
      text: assistantText,
      reasoning: reasoning || undefined,
    };

    if (toolCalls.size === 0) {
      yield { type: "task_end", taskId: opts.taskId, reason: "completed", summary: assistantText.slice(0, 200) };
      return;
    }

    const toolResults: ChatMessageWebview[] = [];
    const collectedDiffs: DiffPreviewFile[] = [];
    for (const tc of toolCalls.values()) {
      if (abort.aborted) break;
      const tool = tools.find((t) => t.name === tc.name);
      if (!tool) {
        toolResults.push(makeToolMessage(tc.id, `[error] unknown tool "${tc.name}"`));
        yield { type: "tool_call_end", toolCallId: tc.id, ok: false, resultPreview: "unknown tool", errorMessage: "unknown tool" };
        continue;
      }
      let parsedArgs: unknown;
      try {
        parsedArgs = (tool.schema as ZodType<unknown>).parse(tc.args ? JSON.parse(tc.args) : {});
      } catch (e) {
        const msg = `[error] invalid args for ${tc.name}: ${(e as Error).message}`;
        toolResults.push(makeToolMessage(tc.id, msg));
        yield { type: "tool_call_end", toolCallId: tc.id, ok: false, resultPreview: msg, errorMessage: msg };
        continue;
      }

      const risk: RiskLevel =
        tool.assessRisk?.(parsedArgs as Record<string, unknown>) ?? tool.riskLevel;
      const argsPreview = previewArgs(tc.args);
      yield { type: "tool_call_start", toolCallId: tc.id, name: tc.name ?? "?", argsPreview, risk };

      const evaluation = evaluateApproval(opts.policy, risk);
      if (evaluation.decision === "auto-reject") {
        const msg = `[rejected by policy] ${evaluation.reason}`;
        toolResults.push(makeToolMessage(tc.id, msg));
        yield { type: "tool_call_end", toolCallId: tc.id, ok: false, resultPreview: msg, errorMessage: msg };
        continue;
      }
      if (evaluation.decision === "ask") {
        const req: ApprovalRequest = {
          id: tc.id,
          toolName: tc.name ?? "?",
          argsPreview,
          riskLevel: risk,
          rationale: evaluation.reason,
        };
        yield { type: "tool_pending_approval", req };
        const decision = await deps.requestApproval(req);
        if (!decision.approved) {
          const msg = `[rejected by user] ${tc.name ?? ""}`;
          toolResults.push(makeToolMessage(tc.id, msg));
          yield { type: "tool_call_end", toolCallId: tc.id, ok: false, resultPreview: msg, errorMessage: msg };
          continue;
        }
      }

      const ctx: ToolContext = {
        workspaceRoot: deps.workspaceRoot,
        signal: abort,
        log: () => {},
        ui: deps.ui,
        security: deps.security,
        checkpoints: deps.checkpoints,
        flow: deps.flow,
        taskId: opts.taskId,
      };
      try {
        const result = await tool.execute(parsedArgs as Record<string, unknown>, ctx);
        const preview = result.content?.slice(0, 1024) ?? "";
        toolResults.push(makeToolMessage(tc.id, result.content ?? "[no content]"));
        if (result.diff) {
          for (const f of result.diff.files) {
            collectedDiffs.push(buildDiffPreview(f.path, f.before, f.after));
          }
        }
        yield { type: "tool_call_end", toolCallId: tc.id, ok: !result.error, resultPreview: preview, errorMessage: result.error };
      } catch (e) {
        const msg = `[error] ${tc.name}: ${(e as Error).message}`;
        toolResults.push(makeToolMessage(tc.id, msg));
        yield { type: "tool_call_end", toolCallId: tc.id, ok: false, resultPreview: msg, errorMessage: msg };
      }
    }

    if (collectedDiffs.length > 0) {
      yield { type: "diff", files: collectedDiffs };
    }

    messages = [
      ...messages,
      { id: makeMsgId(), role: "assistant", content: assistantText, ts: Date.now() },
      ...toolResults,
    ];
  }

  yield { type: "error", message: `agent stopped after ${MAX_ROUNDS} rounds without natural completion` };
  yield { type: "task_end", taskId: opts.taskId, reason: "failed" };
}

function filterTools(mode: ModeProfile, skills: SkillDefinition[], all: string[]): string[] {
  const allowed = new Set<string>();
  if (Array.isArray(mode.allowedTools)) {
    for (const t of mode.allowedTools) if (all.includes(t)) allowed.add(t);
  } else {
    for (const t of all) allowed.add(t);
  }
  // Skills can further constrain, but cannot expand beyond the mode allow-list.
  if (skills.length > 0) {
    const skillAllowed = new Set<string>();
    for (const s of skills) {
      if (!s.allowedTools) continue;
      for (const t of s.allowedTools) skillAllowed.add(t);
    }
    if (skillAllowed.size > 0) {
      for (const t of [...allowed]) {
        if (!skillAllowed.has(t)) allowed.delete(t);
      }
    }
  }
  return [...allowed];
}

function summarizeTools(tools: ToolDefinition[]): string {
  if (tools.length === 0) return "";
  const lines = tools.map((t) => `- ${t.name} (risk: ${t.riskLevel}, category: ${t.category}): ${t.description}`);
  return `--- AVAILABLE TOOLS ---\n${lines.join("\n")}\n--- END AVAILABLE TOOLS ---`;
}

function previewArgs(rawJson: string): string {
  if (!rawJson) return "{}";
  if (rawJson.length <= 256) return rawJson;
  return rawJson.slice(0, 253) + "...";
}

function makeToolMessage(toolCallId: string, content: string): ChatMessageWebview {
  return {
    id: makeMsgId(),
    role: "tool",
    content,
    toolCallId,
    ts: Date.now(),
  };
}

function makeMsgId(): string {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}
