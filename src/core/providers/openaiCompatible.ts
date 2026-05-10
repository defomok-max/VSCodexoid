import type {
  ChatDelta,
  ChatRequest,
  ChatResponse,
  ChatToolCall,
  LLMProvider,
} from "./providerTypes";
import { ProviderError } from "./providerTypes";
import type { ChatMessage, ModelInfo, ProviderProfile } from "../../shared/types";
import { readSseEvents } from "./util/sse";
import { hasImages, toOpenAIContentBlocks } from "./util/multimodal";

/**
 * Generic OpenAI-compatible adapter. Handles the `/v1/chat/completions` shape
 * used by OpenAI, Groq, DeepSeek, xAI, Together, Fireworks, Perplexity,
 * Mistral, OpenRouter, LM Studio, and LocalAI. Azure OpenAI is supported by
 * passing the deployment-shaped base URL (`{baseUrl}/openai/deployments/{deploy}`)
 * and an `api-key` header in the profile.
 */
export class OpenAICompatibleProvider implements LLMProvider {
  readonly supportsTools = true;
  readonly supportsVision = true;
  readonly supportsReasoningEffort = true;
  readonly supportsPromptCaching = true;
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
    return (this.profile.baseUrl ?? "https://api.openai.com").replace(/\/$/, "");
  }

  private buildHeaders(apiKey?: string): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.profile.headers,
    };
    if (apiKey) {
      // Most OpenAI-compatible APIs accept `Authorization: Bearer`; Azure uses `api-key` header.
      const useApiKeyHeader = !!h["api-key"] || this.profile.type === "azure-openai";
      if (useApiKeyHeader) h["api-key"] = apiKey;
      else h["Authorization"] = `Bearer ${apiKey}`;
    }
    if (this.profile.organization) h["OpenAI-Organization"] = this.profile.organization;
    if (this.profile.project) h["OpenAI-Project"] = this.profile.project;
    return h;
  }

  async listModels(opts: { apiKey?: string }): Promise<ModelInfo[]> {
    const url = `${this.baseUrl}/v1/models`;
    const res = await fetch(url, { headers: this.buildHeaders(opts.apiKey) });
    if (!res.ok) {
      throw new ProviderError(
        `listModels failed: ${res.status} ${res.statusText}`,
        this.id,
        res.status,
      );
    }
    const data = (await res.json()) as { data?: { id: string }[] };
    return (data.data ?? []).map((m) => ({ id: m.id, name: m.id }));
  }

  async chat(req: ChatRequest, opts: { apiKey?: string }): Promise<ChatResponse> {
    const body = this.buildBody(req, false);
    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: this.buildHeaders(opts.apiKey),
      body: JSON.stringify(body),
      signal: req.signal,
    });
    if (!res.ok) {
      const text = await safeText(res);
      throw new ProviderError(
        `chat failed: ${res.status} ${res.statusText}: ${text}`,
        this.id,
        res.status,
      );
    }
    const json = (await res.json()) as OpenAIChatCompletionResponse;
    return parseChatCompletion(json);
  }

  async *stream(req: ChatRequest, opts: { apiKey?: string }): AsyncIterable<ChatDelta> {
    const body = this.buildBody(req, true);
    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { ...this.buildHeaders(opts.apiKey), Accept: "text/event-stream" },
      body: JSON.stringify(body),
      signal: req.signal,
    });
    if (!res.ok) {
      const text = await safeText(res);
      throw new ProviderError(
        `stream failed: ${res.status} ${res.statusText}: ${text}`,
        this.id,
        res.status,
      );
    }
    // Track partial tool calls so we can emit `tool_call_start` once.
    const announced = new Set<string>();
    let usage: { inputTokens?: number; outputTokens?: number } | undefined;
    let finishReason: ChatResponse["finishReason"] | undefined;
    for await (const data of readSseEvents(res)) {
      let event: OpenAIStreamChunk;
      try {
        event = JSON.parse(data) as OpenAIStreamChunk;
      } catch {
        continue;
      }
      const choice = event.choices?.[0];
      if (!choice) {
        if (event.usage) {
          usage = {
            inputTokens: event.usage.prompt_tokens,
            outputTokens: event.usage.completion_tokens,
          };
        }
        continue;
      }
      const d = choice.delta;
      if (d?.content) yield { type: "text", text: d.content };
      if (d?.reasoning_content) yield { type: "reasoning", text: d.reasoning_content };
      if (d?.tool_calls) {
        for (const tc of d.tool_calls) {
          const id = tc.id ?? `tc_${tc.index ?? 0}`;
          if (tc.function?.name && !announced.has(id)) {
            announced.add(id);
            yield { type: "tool_call_start", id, name: tc.function.name };
          }
          const args = tc.function?.arguments;
          if (args) yield { type: "tool_call_args", id, argsDelta: args };
        }
      }
      if (choice.finish_reason) {
        finishReason = mapFinishReason(choice.finish_reason);
      }
    }
    if (usage) yield { type: "usage", ...usage };
    yield { type: "finish", reason: finishReason };
  }

  private buildBody(req: ChatRequest, stream: boolean): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages.map(toOpenAIMessage),
      stream,
      ...(stream ? { stream_options: { include_usage: true } } : {}),
    };
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.maxOutputTokens !== undefined) body.max_tokens = req.maxOutputTokens;
    if (req.reasoningEffort && this.supportsReasoningEffort) {
      // OpenAI o-series uses `reasoning_effort`; some others ignore it harmlessly.
      body.reasoning_effort = req.reasoningEffort === "extreme" ? "high" : req.reasoningEffort;
    }
    if (req.tools && req.tools.length > 0) {
      body.tools = req.tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
      if (req.toolChoice) {
        body.tool_choice =
          typeof req.toolChoice === "string"
            ? req.toolChoice
            : { type: "function", function: { name: req.toolChoice.name } };
      }
    }
    if (req.extra) Object.assign(body, req.extra);
    if (this.profile.customParameters) Object.assign(body, this.profile.customParameters);
    return body;
  }
}

function toOpenAIMessage(m: ChatMessage): Record<string, unknown> {
  const base: Record<string, unknown> = { role: m.role };
  if (m.role === "user" && hasImages(m)) {
    base.content = toOpenAIContentBlocks(m);
  } else {
    base.content = m.content;
  }
  if (m.role === "tool" && m.toolCallId) base.tool_call_id = m.toolCallId;
  if (m.toolCalls && m.toolCalls.length > 0) {
    base.tool_calls = m.toolCalls.map((tc) => ({
      id: tc.id,
      type: "function",
      function: { name: tc.name, arguments: tc.argsJson },
    }));
    if (!m.content) base.content = null;
  }
  return base;
}

function parseChatCompletion(json: OpenAIChatCompletionResponse): ChatResponse {
  const choice = json.choices?.[0];
  const content = choice?.message?.content ?? "";
  const toolCalls: ChatToolCall[] | undefined = choice?.message?.tool_calls?.map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    argsJson: tc.function.arguments,
  }));
  return {
    content,
    toolCalls,
    finishReason: mapFinishReason(choice?.finish_reason),
    usage: json.usage
      ? { inputTokens: json.usage.prompt_tokens, outputTokens: json.usage.completion_tokens }
      : undefined,
  };
}

function mapFinishReason(r?: string): ChatResponse["finishReason"] {
  if (!r) return undefined;
  if (r === "stop" || r === "length" || r === "tool_calls" || r === "content_filter") return r;
  if (r === "function_call") return "tool_calls";
  return "stop";
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 2000);
  } catch {
    return "";
  }
}

interface OpenAIChatCompletionResponse {
  choices: {
    message: {
      content?: string;
      tool_calls?: { id: string; function: { name: string; arguments: string } }[];
    };
    finish_reason?: string;
  }[];
  usage?: { prompt_tokens: number; completion_tokens: number };
}

interface OpenAIStreamChunk {
  choices?: {
    delta?: {
      content?: string;
      reasoning_content?: string;
      tool_calls?: {
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }[];
    };
    finish_reason?: string;
  }[];
  usage?: { prompt_tokens: number; completion_tokens: number };
}
