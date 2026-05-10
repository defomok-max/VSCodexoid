import type {
  ChatDelta,
  ChatRequest,
  ChatResponse,
  LLMProvider,
} from "./providerTypes";
import { ProviderError } from "./providerTypes";
import type { ModelInfo, ProviderProfile } from "../../shared/types";

/**
 * Ollama-native adapter. Uses Ollama's `/api/chat` endpoint which supports
 * streaming via newline-delimited JSON (NDJSON), tool calling, and prompt
 * caching. For OpenAI-compatible Ollama endpoints prefer
 * `OpenAICompatibleProvider` with `baseUrl` pointing to `http://localhost:11434/v1`.
 */
export class OllamaProvider implements LLMProvider {
  readonly supportsTools = true;
  readonly supportsVision = true;
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
    return (this.profile.baseUrl ?? "http://localhost:11434").replace(/\/$/, "");
  }

  async listModels(_opts: { apiKey?: string }): Promise<ModelInfo[]> {
    const res = await fetch(`${this.baseUrl}/api/tags`);
    if (!res.ok) {
      throw new ProviderError(
        `listModels failed: ${res.status} ${res.statusText}`,
        this.id,
        res.status,
      );
    }
    const json = (await res.json()) as { models?: { name: string; size?: number }[] };
    return (json.models ?? []).map((m) => ({ id: m.name }));
  }

  async chat(req: ChatRequest, _opts: { apiKey?: string }): Promise<ChatResponse> {
    const body = this.buildBody(req, false);
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.profile.headers },
      body: JSON.stringify(body),
      signal: req.signal,
    });
    if (!res.ok) {
      throw new ProviderError(
        `chat failed: ${res.status} ${res.statusText}`,
        this.id,
        res.status,
      );
    }
    const json = (await res.json()) as OllamaChatResponse;
    return {
      content: json.message?.content ?? "",
      toolCalls: json.message?.tool_calls?.map((tc, i) => ({
        id: `tc_${i}`,
        name: tc.function.name,
        argsJson: JSON.stringify(tc.function.arguments ?? {}),
      })),
      finishReason: json.done ? "stop" : undefined,
      usage:
        json.prompt_eval_count !== undefined || json.eval_count !== undefined
          ? { inputTokens: json.prompt_eval_count, outputTokens: json.eval_count }
          : undefined,
    };
  }

  async *stream(req: ChatRequest, _opts: { apiKey?: string }): AsyncIterable<ChatDelta> {
    const body = this.buildBody(req, true);
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.profile.headers },
      body: JSON.stringify(body),
      signal: req.signal,
    });
    if (!res.ok) {
      throw new ProviderError(
        `stream failed: ${res.status} ${res.statusText}`,
        this.id,
        res.status,
      );
    }
    if (!res.body) throw new ProviderError("missing response body", this.id);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let toolIdx = 0;
    let usage: { inputTokens?: number; outputTokens?: number } | undefined;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          let json: OllamaChatResponse;
          try {
            json = JSON.parse(line) as OllamaChatResponse;
          } catch {
            continue;
          }
          if (json.message?.content) yield { type: "text", text: json.message.content };
          if (json.message?.tool_calls) {
            for (const tc of json.message.tool_calls) {
              const id = `tc_${toolIdx++}`;
              yield { type: "tool_call_start", id, name: tc.function.name };
              yield {
                type: "tool_call_args",
                id,
                argsDelta: JSON.stringify(tc.function.arguments ?? {}),
              };
            }
          }
          if (json.done) {
            if (json.prompt_eval_count !== undefined || json.eval_count !== undefined) {
              usage = { inputTokens: json.prompt_eval_count, outputTokens: json.eval_count };
            }
          }
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        /* noop */
      }
    }
    if (usage) yield { type: "usage", ...usage };
    yield { type: "finish", reason: "stop" };
  }

  private buildBody(req: ChatRequest, stream: boolean): Record<string, unknown> {
    const messages = req.messages.map((m) => ({
      role: m.role === "tool" ? "tool" : m.role,
      content: m.content,
      tool_call_id: m.toolCallId,
      tool_calls: m.toolCalls?.map((tc) => ({
        function: { name: tc.name, arguments: safeParseArgs(tc.argsJson) },
      })),
    })) as unknown[];
    const body: Record<string, unknown> = {
      model: req.model,
      messages,
      stream,
      options: {
        temperature: req.temperature,
        num_predict: req.maxOutputTokens,
      },
    };
    if (req.tools && req.tools.length > 0) {
      body.tools = req.tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
    }
    return body;
  }
}

function safeParseArgs(s: string): unknown {
  try {
    return JSON.parse(s || "{}");
  } catch {
    return {};
  }
}

interface OllamaChatResponse {
  message?: { role: string; content?: string; tool_calls?: { function: { name: string; arguments?: unknown } }[] };
  done?: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
}
