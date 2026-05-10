import type { ChatDelta, ChatRequest, ChatResponse, LLMProvider } from "./providerTypes";
import { ProviderError } from "./providerTypes";
import type { ChatMessage, ModelInfo, ProviderProfile } from "../../shared/types";

/**
 * Google Gemini adapter using the v1beta `generativelanguage` REST API.
 *
 * Streaming uses `:streamGenerateContent?alt=sse`. The response shape isn't
 * standard SSE — Google sends one JSON object per `data:` event. This adapter
 * adapts that into our `ChatDelta` channel.
 */
export class GoogleGeminiProvider implements LLMProvider {
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
    return (this.profile.baseUrl ?? "https://generativelanguage.googleapis.com").replace(/\/$/, "");
  }

  private headers(): Record<string, string> {
    return { "Content-Type": "application/json", ...this.profile.headers };
  }

  private url(model: string, path: string, apiKey?: string): string {
    const u = new URL(`${this.baseUrl}/v1beta/models/${encodeURIComponent(model)}:${path}`);
    if (apiKey) u.searchParams.set("key", apiKey);
    return u.toString();
  }

  async listModels(opts: { apiKey?: string }): Promise<ModelInfo[]> {
    const u = new URL(`${this.baseUrl}/v1beta/models`);
    if (opts.apiKey) u.searchParams.set("key", opts.apiKey);
    const res = await fetch(u, { headers: this.headers() });
    if (!res.ok) {
      throw new ProviderError(
        `listModels failed: ${res.status} ${res.statusText}`,
        this.id,
        res.status,
      );
    }
    const data = (await res.json()) as { models?: { name: string }[] };
    return (data.models ?? [])
      .map((m) => m.name.replace(/^models\//, ""))
      .filter((id) => id.includes("gemini"))
      .map((id) => ({ id }));
  }

  async chat(req: ChatRequest, opts: { apiKey?: string }): Promise<ChatResponse> {
    const body = this.buildBody(req);
    const res = await fetch(this.url(req.model, "generateContent", opts.apiKey), {
      method: "POST",
      headers: this.headers(),
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
    const json = (await res.json()) as GeminiResponse;
    return parseGeminiResponse(json);
  }

  async *stream(req: ChatRequest, opts: { apiKey?: string }): AsyncIterable<ChatDelta> {
    const body = this.buildBody(req);
    const u = new URL(this.url(req.model, "streamGenerateContent", opts.apiKey));
    u.searchParams.set("alt", "sse");
    const res = await fetch(u, {
      method: "POST",
      headers: { ...this.headers(), Accept: "text/event-stream" },
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
    if (!res.body) throw new ProviderError("missing response body", this.id);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let usage: { inputTokens?: number; outputTokens?: number } | undefined;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buffer.indexOf("\n\n")) !== -1) {
          const block = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          const lines = block.split("\n");
          const dataLines = lines.filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim());
          if (dataLines.length === 0) continue;
          const data = dataLines.join("");
          try {
            const json = JSON.parse(data) as GeminiResponse;
            for (const cand of json.candidates ?? []) {
              for (const part of cand.content?.parts ?? []) {
                if (part.text) yield { type: "text", text: part.text };
                if (part.functionCall) {
                  yield {
                    type: "tool_call_start",
                    id: part.functionCall.name,
                    name: part.functionCall.name,
                  };
                  yield {
                    type: "tool_call_args",
                    id: part.functionCall.name,
                    argsDelta: JSON.stringify(part.functionCall.args ?? {}),
                  };
                }
              }
            }
            if (json.usageMetadata) {
              usage = {
                inputTokens: json.usageMetadata.promptTokenCount,
                outputTokens: json.usageMetadata.candidatesTokenCount,
              };
            }
          } catch {
            /* skip non-JSON keepalives */
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

  private buildBody(req: ChatRequest): Record<string, unknown> {
    const sysInstruction = req.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const contents = req.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : m.role === "tool" ? "function" : "user",
        parts: toParts(m),
      }));
    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: req.temperature,
        maxOutputTokens: req.maxOutputTokens,
      },
    };
    if (sysInstruction) body.systemInstruction = { parts: [{ text: sysInstruction }] };
    if (req.tools && req.tools.length > 0) {
      body.tools = [
        {
          functionDeclarations: req.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          })),
        },
      ];
    }
    return body;
  }
}

function toParts(m: ChatMessage): { text?: string; functionCall?: { name: string; args: unknown } }[] {
  const parts: { text?: string; functionCall?: { name: string; args: unknown } }[] = [];
  if (m.content) parts.push({ text: m.content });
  if (m.role === "assistant" && m.toolCalls) {
    for (const tc of m.toolCalls) {
      let args: unknown = {};
      try {
        args = JSON.parse(tc.argsJson || "{}");
      } catch {
        /* keep empty */
      }
      parts.push({ functionCall: { name: tc.name, args } });
    }
  }
  return parts;
}

function parseGeminiResponse(json: GeminiResponse): ChatResponse {
  let content = "";
  const toolCalls: ChatResponse["toolCalls"] = [];
  for (const cand of json.candidates ?? []) {
    for (const part of cand.content?.parts ?? []) {
      if (part.text) content += part.text;
      if (part.functionCall) {
        toolCalls.push({
          id: part.functionCall.name,
          name: part.functionCall.name,
          argsJson: JSON.stringify(part.functionCall.args ?? {}),
        });
      }
    }
  }
  return {
    content,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    finishReason: "stop",
    usage: json.usageMetadata
      ? {
          inputTokens: json.usageMetadata.promptTokenCount,
          outputTokens: json.usageMetadata.candidatesTokenCount,
        }
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

interface GeminiResponse {
  candidates?: {
    content?: { parts?: { text?: string; functionCall?: { name: string; args: unknown } }[] };
  }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}
