import type {
  ChatDelta,
  ChatRequest,
  ChatResponse,
  LLMProvider,
} from "./providerTypes";
import { ProviderError } from "./providerTypes";
import type { ModelInfo, ProviderProfile } from "../../shared/types";
import { readSseEvents } from "./util/sse";

/**
 * Anthropic Messages API adapter.
 *
 * - System messages are concatenated into the top-level `system` field.
 * - User/assistant messages are translated into Anthropic's content blocks.
 * - Tool calls map to Anthropic `tool_use` / `tool_result` blocks.
 * - Streaming uses SSE events of types `content_block_delta`,
 *   `message_delta`, and `message_stop`.
 */
export class AnthropicProvider implements LLMProvider {
  readonly supportsTools = true;
  readonly supportsVision = true;
  readonly supportsReasoningEffort = true;
  readonly supportsPromptCaching = true;
  readonly supportsJsonMode = false;
  readonly supportsComputerUse = true;

  constructor(public readonly profile: ProviderProfile) {}

  get id(): string {
    return this.profile.id;
  }
  get name(): string {
    return this.profile.name;
  }
  get type(): ProviderProfile["type"] {
    return this.profile.type;
  }

  private get baseUrl(): string {
    return (this.profile.baseUrl ?? "https://api.anthropic.com").replace(/\/$/, "");
  }

  private headers(apiKey?: string): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      ...(apiKey ? { "x-api-key": apiKey } : {}),
      ...this.profile.headers,
    };
  }

  async listModels(_opts: { apiKey?: string }): Promise<ModelInfo[]> {
    // Anthropic does not expose a public /v1/models route consistently across
    // tiers. Fall back to a curated, manually-maintained list — the user can
    // override via the profile's `staticModels` mechanism.
    const fallback: ModelInfo[] = [
      { id: "claude-opus-4-5", contextWindow: 200000, supportsTools: true, supportsVision: true },
      { id: "claude-sonnet-4-5", contextWindow: 200000, supportsTools: true, supportsVision: true },
      { id: "claude-3-5-sonnet-latest", contextWindow: 200000, supportsTools: true, supportsVision: true },
      { id: "claude-3-5-haiku-latest", contextWindow: 200000, supportsTools: true, supportsVision: true },
      { id: "claude-3-opus-latest", contextWindow: 200000, supportsTools: true, supportsVision: true },
    ];
    return fallback;
  }

  async chat(req: ChatRequest, opts: { apiKey?: string }): Promise<ChatResponse> {
    const body = this.buildBody(req, false);
    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: this.headers(opts.apiKey),
      body: JSON.stringify(body),
      signal: req.signal,
    });
    if (!res.ok) {
      throw new ProviderError(
        `chat failed: ${res.status} ${res.statusText}: ${await safeText(res)}`,
        this.id,
        res.status,
      );
    }
    const json = (await res.json()) as AnthropicMessageResponse;
    return parseAnthropicMessage(json);
  }

  async *stream(req: ChatRequest, opts: { apiKey?: string }): AsyncIterable<ChatDelta> {
    const body = this.buildBody(req, true);
    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: { ...this.headers(opts.apiKey), Accept: "text/event-stream" },
      body: JSON.stringify(body),
      signal: req.signal,
    });
    if (!res.ok) {
      throw new ProviderError(
        `stream failed: ${res.status} ${res.statusText}: ${await safeText(res)}`,
        this.id,
        res.status,
      );
    }

    const toolBuf = new Map<number, { id: string; name: string }>();
    let usageOut: { inputTokens?: number; outputTokens?: number } | undefined;

    for await (const data of readSseEvents(res)) {
      let evt: AnthropicStreamEvent;
      try {
        evt = JSON.parse(data) as AnthropicStreamEvent;
      } catch {
        continue;
      }
      switch (evt.type) {
        case "message_start":
          if (evt.message?.usage) {
            usageOut = { inputTokens: evt.message.usage.input_tokens };
          }
          break;
        case "content_block_start":
          if (evt.content_block?.type === "tool_use") {
            toolBuf.set(evt.index ?? 0, {
              id: evt.content_block.id!,
              name: evt.content_block.name!,
            });
            yield {
              type: "tool_call_start",
              id: evt.content_block.id!,
              name: evt.content_block.name!,
            };
          }
          break;
        case "content_block_delta":
          if (evt.delta?.type === "text_delta" && evt.delta.text) {
            yield { type: "text", text: evt.delta.text };
          } else if (evt.delta?.type === "thinking_delta" && evt.delta.thinking) {
            yield { type: "reasoning", text: evt.delta.thinking };
          } else if (evt.delta?.type === "input_json_delta" && evt.delta.partial_json) {
            const slot = toolBuf.get(evt.index ?? 0);
            if (slot) {
              yield { type: "tool_call_args", id: slot.id, argsDelta: evt.delta.partial_json };
            }
          }
          break;
        case "message_delta":
          if (evt.usage) {
            usageOut = {
              ...(usageOut ?? {}),
              outputTokens: evt.usage.output_tokens,
            };
          }
          break;
        case "message_stop":
          if (usageOut) yield { type: "usage", ...usageOut };
          yield { type: "finish", reason: "stop" };
          return;
        case "error":
          yield { type: "error", message: evt.error?.message ?? "anthropic stream error" };
          return;
        default:
          break;
      }
    }
    yield { type: "finish", reason: "stop" };
  }

  private buildBody(req: ChatRequest, stream: boolean): Record<string, unknown> {
    const sysParts: string[] = [];
    const messages: AnthropicMessage[] = [];
    for (const m of req.messages) {
      if (m.role === "system") {
        sysParts.push(m.content);
        continue;
      }
      if (m.role === "tool") {
        messages.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: m.toolCallId ?? "",
              content: m.content,
            },
          ],
        });
        continue;
      }
      const content: AnthropicContentBlock[] = [];
      if (m.content) content.push({ type: "text", text: m.content });
      if (m.role === "assistant" && m.toolCalls) {
        for (const tc of m.toolCalls) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(tc.argsJson || "{}");
          } catch {
            parsed = {};
          }
          content.push({ type: "tool_use", id: tc.id, name: tc.name, input: parsed });
        }
      }
      messages.push({ role: m.role === "assistant" ? "assistant" : "user", content });
    }
    const body: Record<string, unknown> = {
      model: req.model,
      messages,
      max_tokens: req.maxOutputTokens ?? 4096,
      stream,
    };
    if (sysParts.length > 0) body.system = sysParts.join("\n\n");
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.tools && req.tools.length > 0) {
      body.tools = req.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
      if (req.toolChoice) {
        body.tool_choice =
          typeof req.toolChoice === "string"
            ? { type: req.toolChoice === "required" ? "any" : req.toolChoice }
            : { type: "tool", name: req.toolChoice.name };
      }
    }
    if (req.reasoningEffort === "high" || req.reasoningEffort === "extreme") {
      body.thinking = { type: "enabled", budget_tokens: req.reasoningEffort === "extreme" ? 16000 : 8000 };
    }
    return body;
  }
}

function parseAnthropicMessage(json: AnthropicMessageResponse): ChatResponse {
  let content = "";
  const toolCalls: ChatResponse["toolCalls"] = [];
  for (const block of json.content ?? []) {
    if (block.type === "text") content += block.text ?? "";
    else if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id ?? "",
        name: block.name ?? "",
        argsJson: JSON.stringify(block.input ?? {}),
      });
    }
  }
  return {
    content,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    finishReason:
      json.stop_reason === "tool_use"
        ? "tool_calls"
        : json.stop_reason === "end_turn"
          ? "stop"
          : json.stop_reason === "max_tokens"
            ? "length"
            : "stop",
    usage: json.usage
      ? { inputTokens: json.usage.input_tokens, outputTokens: json.usage.output_tokens }
      : undefined,
  };
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 2000);
  } catch {
    return "";
  }
}

interface AnthropicMessage {
  role: "user" | "assistant";
  content: AnthropicContentBlock[];
}
type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string };

interface AnthropicMessageResponse {
  content?: { type: string; text?: string; id?: string; name?: string; input?: unknown }[];
  stop_reason?: string;
  usage?: { input_tokens: number; output_tokens: number };
}

interface AnthropicStreamEvent {
  type: string;
  index?: number;
  message?: { usage?: { input_tokens: number } };
  content_block?: { type: string; id?: string; name?: string };
  delta?: {
    type: string;
    text?: string;
    partial_json?: string;
    thinking?: string;
  };
  usage?: { output_tokens: number };
  error?: { message: string };
}
