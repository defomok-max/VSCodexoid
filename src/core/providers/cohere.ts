import type {
  ChatDelta,
  ChatRequest,
  ChatResponse,
  LLMProvider,
} from "./providerTypes";
import { ProviderError } from "./providerTypes";
import type { ChatMessage, ModelInfo, ProviderProfile } from "../../shared/types";
import { readSseEvents } from "./util/sse";

/**
 * Native adapter for Cohere's `/v2/chat` API
 * (https://docs.cohere.com/reference/chat).
 *
 * Why a dedicated adapter (instead of the OpenAI-compatible fallback):
 * - Cohere's tool-calling shape is similar to but not identical to OpenAI's
 *   (`type: "function"` is required; tool results are sent as a `tool` role
 *   message with `tool_call_id`, not the `tool_result` content blocks).
 * - Streaming is line-delimited SSE with event types
 *   `content-delta` / `tool-call-start` / `tool-call-delta` / `message-end`
 *   that don't match OpenAI's chunked-deltas shape.
 *
 * Falls back to a curated model list when the user hasn't supplied a key
 * (Cohere requires auth for `/v1/models`).
 */
export class CohereProvider implements LLMProvider {
  readonly supportsTools = true;
  readonly supportsVision = false;
  readonly supportsReasoningEffort = false;
  readonly supportsPromptCaching = false;
  readonly supportsJsonMode = true;
  readonly supportsComputerUse = false;

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
    return (this.profile.baseUrl ?? "https://api.cohere.com").replace(/\/$/, "");
  }

  private headers(apiKey?: string): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      ...this.profile.headers,
    };
  }

  async listModels(opts: { apiKey?: string }): Promise<ModelInfo[]> {
    if (!opts.apiKey) {
      return COHERE_FALLBACK_MODELS;
    }
    try {
      const res = await fetch(`${this.baseUrl}/v1/models?endpoint=chat&page_size=100`, {
        headers: this.headers(opts.apiKey),
      });
      if (!res.ok) return COHERE_FALLBACK_MODELS;
      const json = (await res.json()) as { models?: { name: string; context_length?: number }[] };
      const models = json.models ?? [];
      if (models.length === 0) return COHERE_FALLBACK_MODELS;
      return models.map((m) => ({
        id: m.name,
        contextWindow: m.context_length,
        supportsTools: true,
        supportsVision: false,
      }));
    } catch {
      return COHERE_FALLBACK_MODELS;
    }
  }

  async chat(req: ChatRequest, opts: { apiKey?: string }): Promise<ChatResponse> {
    const body = this.buildBody(req, false);
    const res = await fetch(`${this.baseUrl}/v2/chat`, {
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
    const json = (await res.json()) as CohereChatResponse;
    return parseCohereResponse(json);
  }

  async *stream(req: ChatRequest, opts: { apiKey?: string }): AsyncIterable<ChatDelta> {
    const body = this.buildBody(req, true);
    const res = await fetch(`${this.baseUrl}/v2/chat`, {
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
      let evt: CohereStreamEvent;
      try {
        evt = JSON.parse(data) as CohereStreamEvent;
      } catch {
        continue;
      }
      switch (evt.type) {
        case "content-delta": {
          const text = evt.delta?.message?.content?.text;
          if (text) yield { type: "text", text };
          break;
        }
        case "tool-call-start": {
          const tc = evt.delta?.message?.tool_calls;
          if (tc?.id && tc.function?.name) {
            const idx = evt.index ?? toolBuf.size;
            toolBuf.set(idx, { id: tc.id, name: tc.function.name });
            yield { type: "tool_call_start", id: tc.id, name: tc.function.name };
            if (tc.function.arguments) {
              yield { type: "tool_call_args", id: tc.id, argsDelta: tc.function.arguments };
            }
          }
          break;
        }
        case "tool-call-delta": {
          const partial = evt.delta?.message?.tool_calls?.function?.arguments;
          const slot = toolBuf.get(evt.index ?? 0);
          if (slot && partial) {
            yield { type: "tool_call_args", id: slot.id, argsDelta: partial };
          }
          break;
        }
        case "message-end": {
          const usage = evt.delta?.usage?.tokens;
          if (usage) {
            usageOut = {
              inputTokens: usage.input_tokens,
              outputTokens: usage.output_tokens,
            };
            yield { type: "usage", ...usageOut };
          }
          const reason = mapFinish(evt.delta?.finish_reason);
          yield { type: "finish", reason };
          return;
        }
        default:
          break;
      }
    }
    yield { type: "finish", reason: "stop" };
  }

  private buildBody(req: ChatRequest, stream: boolean): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages.map(toCohereMessage),
      stream,
    };
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.maxOutputTokens !== undefined) body.max_tokens = req.maxOutputTokens;
    if (req.tools && req.tools.length > 0) {
      body.tools = req.tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
      if (req.toolChoice) {
        if (typeof req.toolChoice === "string") {
          if (req.toolChoice === "required") body.tool_choice = "REQUIRED";
          else if (req.toolChoice === "none") body.tool_choice = "NONE";
        }
      }
    }
    return body;
  }
}

function toCohereMessage(m: ChatMessage): CohereMessage {
  if (m.role === "tool") {
    return {
      role: "tool",
      tool_call_id: m.toolCallId ?? "",
      content: m.content,
    };
  }
  if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
    return {
      role: "assistant",
      content: m.content || "",
      tool_calls: m.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: tc.argsJson },
      })),
    };
  }
  return { role: m.role, content: m.content };
}

function parseCohereResponse(json: CohereChatResponse): ChatResponse {
  const content = (json.message?.content ?? [])
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text!)
    .join("");
  const toolCalls = (json.message?.tool_calls ?? []).map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    argsJson: tc.function.arguments ?? "{}",
  }));
  const usage = json.usage?.tokens
    ? {
        inputTokens: json.usage.tokens.input_tokens,
        outputTokens: json.usage.tokens.output_tokens,
      }
    : undefined;
  return {
    content,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    finishReason: mapFinish(json.finish_reason),
    usage,
  };
}

function mapFinish(reason: string | undefined): ChatResponse["finishReason"] {
  switch (reason) {
    case "TOOL_CALL":
      return "tool_calls";
    case "MAX_TOKENS":
      return "length";
    case "ERROR":
    case "ERROR_LIMIT":
    case "ERROR_TOXIC":
      return "error";
    case "STOP_SEQUENCE":
    case "COMPLETE":
    default:
      return "stop";
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 2000);
  } catch {
    return "";
  }
}

const COHERE_FALLBACK_MODELS: ModelInfo[] = [
  { id: "command-a-03-2025", contextWindow: 256000, supportsTools: true, supportsVision: false },
  { id: "command-r-plus-08-2024", contextWindow: 128000, supportsTools: true, supportsVision: false },
  { id: "command-r-08-2024", contextWindow: 128000, supportsTools: true, supportsVision: false },
  { id: "command-r7b-12-2024", contextWindow: 128000, supportsTools: true, supportsVision: false },
];

type CohereMessage =
  | { role: "system" | "user"; content: string }
  | {
      role: "assistant";
      content: string;
      tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

interface CohereChatResponse {
  message?: {
    role?: string;
    content?: { type: string; text?: string }[];
    tool_calls?: { id: string; type: string; function: { name: string; arguments?: string } }[];
  };
  finish_reason?: string;
  usage?: { tokens?: { input_tokens?: number; output_tokens?: number } };
}

interface CohereStreamEvent {
  type: string;
  index?: number;
  delta?: {
    message?: {
      content?: { type?: string; text?: string };
      tool_calls?: {
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      };
    };
    finish_reason?: string;
    usage?: { tokens?: { input_tokens?: number; output_tokens?: number } };
  };
}
