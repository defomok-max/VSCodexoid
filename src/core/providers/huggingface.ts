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
 * Native adapter for the Hugging Face Inference Routers' Messages API
 * (`POST {baseUrl}/v1/chat/completions`). The router exposes any
 * inference-provider-backed text-generation model under an OpenAI-compatible
 * shape, but with two differences worth handling natively:
 *
 * 1. The base URL is `https://router.huggingface.co/v1` (not `/v1` under
 *    `huggingface.co`); using a dedicated adapter lets us default it
 *    correctly and document the user-facing `model` selection (`<repo>:<provider>`).
 * 2. The router ships an `/api/inference-proxy/list-models` endpoint that
 *    returns _all_ chat-capable models rather than just the ones the API key
 *    can hit; we surface a tiny curated fallback so the UI is usable even
 *    without a key.
 *
 * Streaming is plain OpenAI-style SSE (`data: <json>` chunks with
 * `choices[0].delta.content` etc.).
 */
export class HuggingFaceProvider implements LLMProvider {
  readonly supportsTools = true;
  readonly supportsVision = false;
  readonly supportsReasoningEffort = false;
  readonly supportsPromptCaching = false;
  readonly supportsJsonMode = false;
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
    return (this.profile.baseUrl ?? "https://router.huggingface.co").replace(/\/$/, "");
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
    try {
      const res = await fetch(`${this.baseUrl}/v1/models`, {
        headers: this.headers(opts.apiKey),
      });
      if (!res.ok) return HUGGINGFACE_FALLBACK_MODELS;
      const json = (await res.json()) as { data?: { id: string }[] };
      const data = json.data ?? [];
      if (data.length === 0) return HUGGINGFACE_FALLBACK_MODELS;
      return data.map((m) => ({ id: m.id, supportsTools: true, supportsVision: false }));
    } catch {
      return HUGGINGFACE_FALLBACK_MODELS;
    }
  }

  async chat(req: ChatRequest, opts: { apiKey?: string }): Promise<ChatResponse> {
    const body = this.buildBody(req, false);
    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
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
    const json = (await res.json()) as HfChatResponse;
    return parseHfResponse(json);
  }

  async *stream(req: ChatRequest, opts: { apiKey?: string }): AsyncIterable<ChatDelta> {
    const body = this.buildBody(req, true);
    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
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

    const toolCallSlots = new Map<number, { id: string; name: string }>();
    let usageOut: { inputTokens?: number; outputTokens?: number } | undefined;

    for await (const data of readSseEvents(res)) {
      let chunk: HfChatChunk;
      try {
        chunk = JSON.parse(data) as HfChatChunk;
      } catch {
        continue;
      }
      const choice = chunk.choices?.[0];
      const delta = choice?.delta;
      if (delta?.content) yield { type: "text", text: delta.content };
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          let slot = toolCallSlots.get(idx);
          if (!slot && tc.id && tc.function?.name) {
            slot = { id: tc.id, name: tc.function.name };
            toolCallSlots.set(idx, slot);
            yield { type: "tool_call_start", id: slot.id, name: slot.name };
          }
          if (slot && tc.function?.arguments) {
            yield { type: "tool_call_args", id: slot.id, argsDelta: tc.function.arguments };
          }
        }
      }
      if (chunk.usage) {
        usageOut = {
          inputTokens: chunk.usage.prompt_tokens,
          outputTokens: chunk.usage.completion_tokens,
        };
      }
      if (choice?.finish_reason) {
        if (usageOut) yield { type: "usage", ...usageOut };
        yield { type: "finish", reason: mapFinish(choice.finish_reason) };
        return;
      }
    }
    yield { type: "finish", reason: "stop" };
  }

  private buildBody(req: ChatRequest, stream: boolean): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages.map(toHfMessage),
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
      if (req.toolChoice && typeof req.toolChoice === "string") {
        body.tool_choice = req.toolChoice;
      } else if (req.toolChoice && typeof req.toolChoice === "object") {
        body.tool_choice = {
          type: "function",
          function: { name: req.toolChoice.name },
        };
      }
    }
    return body;
  }
}

function toHfMessage(m: ChatMessage): Record<string, unknown> {
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

function parseHfResponse(json: HfChatResponse): ChatResponse {
  const choice = json.choices?.[0];
  const content = choice?.message?.content ?? "";
  const toolCalls = (choice?.message?.tool_calls ?? []).map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    argsJson: tc.function.arguments ?? "{}",
  }));
  return {
    content,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    finishReason: mapFinish(choice?.finish_reason),
    usage: json.usage
      ? {
          inputTokens: json.usage.prompt_tokens,
          outputTokens: json.usage.completion_tokens,
        }
      : undefined,
  };
}

function mapFinish(reason: string | undefined): ChatResponse["finishReason"] {
  switch (reason) {
    case "tool_calls":
      return "tool_calls";
    case "length":
      return "length";
    case "content_filter":
      return "content_filter";
    case "error":
      return "error";
    case "stop":
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

const HUGGINGFACE_FALLBACK_MODELS: ModelInfo[] = [
  { id: "meta-llama/Llama-3.3-70B-Instruct", supportsTools: true, supportsVision: false },
  { id: "meta-llama/Llama-3.1-8B-Instruct", supportsTools: true, supportsVision: false },
  { id: "Qwen/Qwen2.5-Coder-32B-Instruct", supportsTools: true, supportsVision: false },
  { id: "Qwen/Qwen2.5-72B-Instruct", supportsTools: true, supportsVision: false },
  { id: "mistralai/Mistral-Nemo-Instruct-2407", supportsTools: true, supportsVision: false },
];

interface HfChatResponse {
  choices?: {
    message?: {
      content?: string;
      tool_calls?: { id: string; function: { name: string; arguments?: string } }[];
    };
    finish_reason?: string;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

interface HfChatChunk {
  choices?: {
    delta?: {
      content?: string;
      tool_calls?: {
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }[];
    };
    finish_reason?: string;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}
