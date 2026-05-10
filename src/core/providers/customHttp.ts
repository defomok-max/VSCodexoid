import type { ChatDelta, ChatRequest, ChatResponse, LLMProvider } from "./providerTypes";
import { ProviderError } from "./providerTypes";
import type { ChatMessage, ModelInfo, ProviderProfile } from "../../shared/types";
import { pickPath, readSseEvents } from "./util/sse";

/**
 * Generic HTTP provider for endpoints that aren't OpenAI / Anthropic / Gemini /
 * Ollama compatible. The user supplies:
 *
 *   - `customHttp.bodyTemplate` — a JSON string containing `${...}` placeholders
 *     (`messages`, `model`, `prompt`, `system`, `temperature`, `tools`).
 *   - `customHttp.responsePath` — a dot-path into the JSON response that
 *     contains the assistant's text (e.g. `choices[0].message.content`).
 *   - `customHttp.streamingParser` — `"sse"`, `"ndjson"`, or `"none"`.
 *   - `customHttp.authScheme` — `"bearer"` (default), `"header"`, `"query"`,
 *     `"none"`. With `"header"` the user provides `customHttp.authParam`.
 *
 * This adapter is intentionally minimal — it doesn't synthesize tool calls
 * (the embedded model has to do that itself). Tool calls in streaming responses
 * are forwarded only when the streamingParser is `"sse"` and the data line is
 * an OpenAI-shaped chunk.
 */
export class CustomHttpProvider implements LLMProvider {
  readonly supportsTools = false;
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

  private get cfg() {
    if (!this.profile.customHttp) {
      throw new ProviderError("customHttp config missing", this.id);
    }
    return this.profile.customHttp;
  }

  private get baseUrl(): string {
    if (!this.profile.baseUrl) throw new ProviderError("baseUrl required", this.id);
    return this.profile.baseUrl.replace(/\/$/, "");
  }

  private buildHeaders(apiKey?: string): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      ...(this.profile.headers ?? {}),
    };
    if (apiKey) {
      const scheme = this.cfg.authScheme ?? "bearer";
      if (scheme === "bearer") h["Authorization"] = `Bearer ${apiKey}`;
      else if (scheme === "header") h[this.cfg.authParam ?? "X-API-Key"] = apiKey;
    }
    return h;
  }

  private buildUrl(apiKey?: string, path = ""): string {
    const u = new URL(this.baseUrl + path);
    if (apiKey && (this.cfg.authScheme ?? "bearer") === "query") {
      u.searchParams.set(this.cfg.authParam ?? "key", apiKey);
    }
    return u.toString();
  }

  async listModels(opts: { apiKey?: string }): Promise<ModelInfo[]> {
    if (this.cfg.staticModels && this.cfg.staticModels.length > 0) {
      return this.cfg.staticModels.map((m) => ({ id: m }));
    }
    if (!this.cfg.listModelsUrl) return [];
    const res = await fetch(this.cfg.listModelsUrl, { headers: this.buildHeaders(opts.apiKey) });
    if (!res.ok) return [];
    const json = await res.json();
    const list = pickPath(json, this.cfg.listModelsPath ?? "data");
    if (!Array.isArray(list)) return [];
    return list
      .map((entry: unknown) => {
        if (typeof entry === "string") return { id: entry };
        if (entry && typeof entry === "object" && "id" in entry) {
          return { id: String((entry as Record<string, unknown>).id) };
        }
        return null;
      })
      .filter((m): m is ModelInfo => !!m);
  }

  async chat(req: ChatRequest, opts: { apiKey?: string }): Promise<ChatResponse> {
    const body = this.renderBody(req);
    const res = await fetch(this.buildUrl(opts.apiKey), {
      method: this.cfg.method ?? "POST",
      headers: this.buildHeaders(opts.apiKey),
      body: JSON.stringify(body),
      signal: req.signal,
    });
    if (!res.ok) {
      throw new ProviderError(
        `customHttp chat failed: ${res.status} ${res.statusText}: ${await safeText(res)}`,
        this.id,
        res.status,
      );
    }
    const json = await res.json();
    const content = String(pickPath(json, this.cfg.responsePath) ?? "");
    return { content, finishReason: "stop" };
  }

  async *stream(req: ChatRequest, opts: { apiKey?: string }): AsyncIterable<ChatDelta> {
    const parser = this.cfg.streamingParser ?? "none";
    if (parser === "none") {
      const r = await this.chat(req, opts);
      if (r.content) yield { type: "text", text: r.content };
      yield { type: "finish", reason: r.finishReason };
      return;
    }
    const body = this.renderBody(req);
    const res = await fetch(this.buildUrl(opts.apiKey), {
      method: this.cfg.method ?? "POST",
      headers: { ...this.buildHeaders(opts.apiKey), Accept: "text/event-stream" },
      body: JSON.stringify(body),
      signal: req.signal,
    });
    if (!res.ok) {
      throw new ProviderError(
        `customHttp stream failed: ${res.status} ${res.statusText}: ${await safeText(res)}`,
        this.id,
        res.status,
      );
    }
    if (parser === "sse") {
      for await (const data of readSseEvents(res)) {
        yield* this.parseStreamChunk(data);
      }
    } else if (parser === "ndjson") {
      if (!res.body) throw new ProviderError("missing response body", this.id);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
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
            yield* this.parseStreamChunk(line);
          }
        }
      } finally {
        try {
          reader.releaseLock();
        } catch {
          /* noop */
        }
      }
    }
    yield { type: "finish", reason: "stop" };
  }

  private *parseStreamChunk(raw: string): Generator<ChatDelta> {
    try {
      const json = JSON.parse(raw);
      const txt = pickPath(json, this.cfg.responsePath);
      if (typeof txt === "string" && txt.length > 0) yield { type: "text", text: txt };
    } catch {
      // not JSON — fall back to literal text
      if (raw.length > 0) yield { type: "text", text: raw };
    }
  }

  private renderBody(req: ChatRequest): unknown {
    const ctx = {
      model: req.model,
      messages: req.messages.map((m: ChatMessage) => ({ role: m.role, content: m.content })),
      prompt: req.messages
        .filter((m) => m.role === "user")
        .map((m) => m.content)
        .join("\n\n"),
      system: req.messages
        .filter((m) => m.role === "system")
        .map((m) => m.content)
        .join("\n\n"),
      temperature: req.temperature ?? 0.7,
      max_tokens: req.maxOutputTokens ?? 2048,
      stream: !!req.stream,
      tools: req.tools ?? [],
    };
    const tpl = this.cfg.bodyTemplate;
    const rendered = tpl.replace(/\$\{([\w.]+)\}/g, (_m, key: string) => {
      const v = (ctx as Record<string, unknown>)[key];
      return JSON.stringify(v ?? null);
    });
    try {
      return JSON.parse(rendered);
    } catch (e) {
      throw new ProviderError(
        `customHttp bodyTemplate did not produce valid JSON: ${(e as Error).message}`,
        this.id,
      );
    }
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 2000);
  } catch {
    return "";
  }
}
