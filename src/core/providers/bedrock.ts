import type {
  ChatDelta,
  ChatRequest,
  ChatResponse,
  ChatToolCall,
  LLMProvider,
} from "./providerTypes";
import { ProviderError } from "./providerTypes";
import type { ChatMessage, ModelInfo, ProviderProfile } from "../../shared/types";
import { signSigV4, type SigV4Credentials } from "./util/sigv4";

/**
 * AWS Bedrock adapter (native, SigV4-signed).
 *
 * Uses the unified **Converse / ConverseStream** APIs (introduced 2024) so
 * the same code path works for Anthropic Claude, Meta Llama, Cohere, Mistral,
 * Amazon Nova, etc. See:
 * https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html
 *
 * Streaming uses Bedrock's binary `application/vnd.amazon.eventstream`
 * framing. We implement a minimal parser inline; CRC validation is skipped
 * because the underlying TLS already provides integrity.
 *
 * Credential resolution order:
 * 1. JSON-encoded `apiKey` argument: `{"accessKeyId":"…","secretAccessKey":"…","sessionToken":"…","region":"…"}`
 * 2. `profile.customParameters` keys: `accessKeyId`, `secretAccessKey`, `sessionToken`, `region`
 * 3. Environment variables: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`, `AWS_REGION` / `AWS_DEFAULT_REGION`
 * 4. Region parsed from `profile.baseUrl` (`https://bedrock-runtime.{region}.amazonaws.com`).
 */
export class BedrockProvider implements LLMProvider {
  readonly supportsTools = true;
  readonly supportsVision = true;
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

  async listModels(_opts: { apiKey?: string }): Promise<ModelInfo[]> {
    // Bedrock has a `ListFoundationModels` admin API but it requires extra
    // IAM. Most users want a known-good shortlist; advanced users can edit
    // their profile to point at any model id (the Converse API just takes
    // the id verbatim in the URL path).
    return [
      {
        id: "anthropic.claude-3-5-sonnet-20241022-v2:0",
        contextWindow: 200000,
        supportsTools: true,
        supportsVision: true,
      },
      {
        id: "anthropic.claude-3-5-haiku-20241022-v1:0",
        contextWindow: 200000,
        supportsTools: true,
        supportsVision: true,
      },
      {
        id: "anthropic.claude-3-opus-20240229-v1:0",
        contextWindow: 200000,
        supportsTools: true,
        supportsVision: true,
      },
      {
        id: "meta.llama3-1-70b-instruct-v1:0",
        contextWindow: 128000,
        supportsTools: true,
        supportsVision: false,
      },
      {
        id: "meta.llama3-1-8b-instruct-v1:0",
        contextWindow: 128000,
        supportsTools: true,
        supportsVision: false,
      },
      {
        id: "mistral.mistral-large-2407-v1:0",
        contextWindow: 128000,
        supportsTools: true,
        supportsVision: false,
      },
      {
        id: "cohere.command-r-plus-v1:0",
        contextWindow: 128000,
        supportsTools: true,
        supportsVision: false,
      },
      {
        id: "amazon.nova-pro-v1:0",
        contextWindow: 300000,
        supportsTools: true,
        supportsVision: true,
      },
    ];
  }

  async chat(req: ChatRequest, opts: { apiKey?: string }): Promise<ChatResponse> {
    const { creds, region } = this.resolveAuth(opts.apiKey);
    const url = `${this.bedrockHost(region)}/model/${encodeURIComponent(req.model)}/converse`;
    const body = JSON.stringify(this.buildConverseBody(req));
    const signed = signSigV4({
      method: "POST",
      url,
      region,
      service: "bedrock",
      body,
      headers: { "content-type": "application/json" },
      credentials: creds,
    });

    const res = await fetch(signed.url, {
      method: "POST",
      headers: signed.headers,
      body,
      signal: req.signal,
    });
    if (!res.ok) {
      throw new ProviderError(
        `Bedrock chat failed: ${res.status} ${res.statusText}: ${await safeText(res)}`,
        this.id,
        res.status,
      );
    }
    const json = (await res.json()) as ConverseResponse;
    return parseConverseResponse(json);
  }

  async *stream(req: ChatRequest, opts: { apiKey?: string }): AsyncIterable<ChatDelta> {
    const { creds, region } = this.resolveAuth(opts.apiKey);
    const url = `${this.bedrockHost(region)}/model/${encodeURIComponent(req.model)}/converse-stream`;
    const body = JSON.stringify(this.buildConverseBody(req));
    const signed = signSigV4({
      method: "POST",
      url,
      region,
      service: "bedrock",
      body,
      headers: { "content-type": "application/json" },
      credentials: creds,
    });

    const res = await fetch(signed.url, {
      method: "POST",
      headers: signed.headers,
      body,
      signal: req.signal,
    });
    if (!res.ok) {
      throw new ProviderError(
        `Bedrock stream failed: ${res.status} ${res.statusText}: ${await safeText(res)}`,
        this.id,
        res.status,
      );
    }
    if (!res.body) throw new ProviderError("Bedrock stream returned no body", this.id);

    const toolBuf = new Map<number, { id: string; name: string; argsBuf: string }>();

    for await (const event of readEventStream(res.body)) {
      const eventType = event.headers[":event-type"];
      if (event.headers[":message-type"] === "exception" || eventType === "exception") {
        throw new ProviderError(
          `Bedrock event-stream exception: ${eventType}: ${event.payload.slice(0, 500)}`,
          this.id,
        );
      }
      let payload: ConverseStreamEvent;
      try {
        payload = JSON.parse(event.payload) as ConverseStreamEvent;
      } catch {
        continue;
      }
      switch (eventType) {
        case "contentBlockStart":
          if (payload.start?.toolUse) {
            const idx = payload.contentBlockIndex ?? 0;
            const id = payload.start.toolUse.toolUseId;
            const name = payload.start.toolUse.name;
            toolBuf.set(idx, { id, name, argsBuf: "" });
            yield { type: "tool_call_start", id, name };
          }
          break;
        case "contentBlockDelta":
          if (payload.delta?.text) {
            yield { type: "text", text: payload.delta.text };
          }
          if (payload.delta?.toolUse?.input) {
            const idx = payload.contentBlockIndex ?? 0;
            const slot = toolBuf.get(idx);
            if (slot) {
              slot.argsBuf += payload.delta.toolUse.input;
              yield { type: "tool_call_args", id: slot.id, argsDelta: payload.delta.toolUse.input };
            }
          }
          break;
        case "contentBlockStop":
          // nothing to flush; argsBuf already streamed
          break;
        case "metadata":
          if (payload.usage) {
            yield {
              type: "usage",
              inputTokens: payload.usage.inputTokens,
              outputTokens: payload.usage.outputTokens,
            };
          }
          break;
        case "messageStop":
          yield { type: "finish", reason: mapStopReason(payload.stopReason) };
          break;
        default:
          // ignore messageStart and any future event types
          break;
      }
    }
  }

  // --- helpers --------------------------------------------------------

  private bedrockHost(region: string): string {
    const explicit = this.profile.baseUrl?.replace(/\/$/, "");
    if (explicit) return explicit;
    return `https://bedrock-runtime.${region}.amazonaws.com`;
  }

  private resolveAuth(apiKey?: string): { creds: SigV4Credentials; region: string } {
    let parsed: Partial<{
      accessKeyId: string;
      secretAccessKey: string;
      sessionToken: string;
      region: string;
    }> = {};
    if (apiKey) {
      try {
        parsed = JSON.parse(apiKey) as typeof parsed;
      } catch {
        // apiKey was not JSON; fall through to other sources.
      }
    }
    const customParams = (this.profile.customParameters ?? {}) as Record<string, string>;

    const accessKeyId =
      parsed.accessKeyId ??
      customParams.accessKeyId ??
      process.env.AWS_ACCESS_KEY_ID ??
      "";
    const secretAccessKey =
      parsed.secretAccessKey ??
      customParams.secretAccessKey ??
      process.env.AWS_SECRET_ACCESS_KEY ??
      "";
    const sessionToken =
      parsed.sessionToken ??
      customParams.sessionToken ??
      process.env.AWS_SESSION_TOKEN;

    if (!accessKeyId || !secretAccessKey) {
      throw new ProviderError(
        "Bedrock requires accessKeyId and secretAccessKey (set them in the profile API key as JSON, in customParameters, or in AWS env vars)",
        this.id,
      );
    }

    const region =
      parsed.region ??
      customParams.region ??
      regionFromBaseUrl(this.profile.baseUrl) ??
      process.env.AWS_REGION ??
      process.env.AWS_DEFAULT_REGION ??
      "us-east-1";

    return {
      creds: { accessKeyId, secretAccessKey, sessionToken },
      region,
    };
  }

  private buildConverseBody(req: ChatRequest): ConverseRequest {
    const { messages, system } = transformMessages(req.messages);
    const out: ConverseRequest = { messages };
    if (system.length) out.system = system.map((t) => ({ text: t }));
    const inferenceConfig: Record<string, number> = {};
    if (typeof req.maxOutputTokens === "number") inferenceConfig.maxTokens = req.maxOutputTokens;
    if (typeof req.temperature === "number") inferenceConfig.temperature = req.temperature;
    if (Object.keys(inferenceConfig).length) out.inferenceConfig = inferenceConfig;
    if (req.tools?.length) {
      out.toolConfig = {
        tools: req.tools.map((t) => ({
          toolSpec: {
            name: t.name,
            description: t.description,
            inputSchema: { json: t.parameters },
          },
        })),
      };
      const tc = req.toolChoice;
      if (tc) {
        if (tc === "none") {
          // Bedrock doesn't expose a "none" — emulate by dropping toolConfig.
          delete out.toolConfig;
        } else if (tc === "auto") {
          out.toolConfig.toolChoice = { auto: {} };
        } else if (tc === "required") {
          out.toolConfig.toolChoice = { any: {} };
        } else if (typeof tc === "object" && tc.name) {
          out.toolConfig.toolChoice = { tool: { name: tc.name } };
        }
      }
    }
    return out;
  }
}

// --- Converse request/response types --------------------------------

interface ConverseRequest {
  messages: ConverseMessage[];
  system?: { text: string }[];
  inferenceConfig?: Record<string, number>;
  toolConfig?: {
    tools: { toolSpec: { name: string; description: string; inputSchema: { json: unknown } } }[];
    toolChoice?: { auto?: object; any?: object; tool?: { name: string } };
  };
}

interface ConverseMessage {
  role: "user" | "assistant";
  content: ConverseContentBlock[];
}

type ConverseContentBlock =
  | { text: string }
  | { toolUse: { toolUseId: string; name: string; input: unknown } }
  | {
      toolResult: {
        toolUseId: string;
        content: { text: string }[];
        status?: "success" | "error";
      };
    };

interface ConverseResponse {
  output?: {
    message?: {
      role: "assistant";
      content: ConverseContentBlock[];
    };
  };
  stopReason?: string;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
}

interface ConverseStreamEvent {
  contentBlockIndex?: number;
  start?: { toolUse?: { toolUseId: string; name: string } };
  delta?: { text?: string; toolUse?: { input?: string } };
  stopReason?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

function transformMessages(messages: ChatMessage[]): {
  messages: ConverseMessage[];
  system: string[];
} {
  const out: ConverseMessage[] = [];
  const system: string[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      if (m.content) system.push(m.content);
      continue;
    }
    if (m.role === "tool") {
      // Tool results from previous turns are folded into a user message.
      const block: ConverseContentBlock = {
        toolResult: {
          toolUseId: m.toolCallId ?? "",
          content: [{ text: m.content ?? "" }],
          status: "success",
        },
      };
      out.push({ role: "user", content: [block] });
      continue;
    }
    if (m.role === "assistant") {
      const blocks: ConverseContentBlock[] = [];
      if (m.content) blocks.push({ text: m.content });
      if (m.toolCalls?.length) {
        for (const tc of m.toolCalls) {
          let parsedArgs: unknown = {};
          try {
            parsedArgs = tc.argsJson ? JSON.parse(tc.argsJson) : {};
          } catch {
            parsedArgs = { _raw: tc.argsJson };
          }
          blocks.push({
            toolUse: { toolUseId: tc.id, name: tc.name, input: parsedArgs },
          });
        }
      }
      if (blocks.length) out.push({ role: "assistant", content: blocks });
      continue;
    }
    // user
    out.push({ role: "user", content: [{ text: m.content ?? "" }] });
  }
  return { messages: out, system };
}

function parseConverseResponse(json: ConverseResponse): ChatResponse {
  let content = "";
  const toolCalls: ChatToolCall[] = [];
  for (const block of json.output?.message?.content ?? []) {
    if ("text" in block && typeof block.text === "string") content += block.text;
    if ("toolUse" in block) {
      toolCalls.push({
        id: block.toolUse.toolUseId,
        name: block.toolUse.name,
        argsJson: JSON.stringify(block.toolUse.input ?? {}),
      });
    }
  }
  return {
    content,
    toolCalls: toolCalls.length ? toolCalls : undefined,
    finishReason: mapStopReason(json.stopReason),
    usage: json.usage
      ? { inputTokens: json.usage.inputTokens, outputTokens: json.usage.outputTokens }
      : undefined,
  };
}

function mapStopReason(reason?: string): ChatResponse["finishReason"] {
  switch (reason) {
    case "end_turn":
    case "stop_sequence":
      return "stop";
    case "max_tokens":
      return "length";
    case "tool_use":
      return "tool_calls";
    case "guardrail_intervened":
    case "content_filtered":
      return "content_filter";
    default:
      return reason ? "stop" : undefined;
  }
}

function regionFromBaseUrl(baseUrl?: string): string | undefined {
  if (!baseUrl) return undefined;
  const m = /bedrock(?:-runtime)?\.([a-z0-9-]+)\.amazonaws\.com/i.exec(baseUrl);
  return m ? m[1] : undefined;
}

async function safeText(r: Response): Promise<string> {
  try {
    return (await r.text()).slice(0, 1000);
  } catch {
    return "";
  }
}

// --- Bedrock event-stream parser (vnd.amazon.eventstream) -----------

interface EventStreamMessage {
  headers: Record<string, string>;
  payload: string;
}

/**
 * Parse Bedrock's binary event-stream format. Each frame:
 *
 *   [4B total length BE]
 *   [4B headers length BE]
 *   [4B prelude CRC]            (skipped, TLS already covers integrity)
 *   [headers ...]
 *   [payload ...]
 *   [4B message CRC]            (skipped)
 *
 * Each header is `1B name-len, name, 1B type, value`. We only care about
 * STRING_VALUE (type 7), which encodes value as `2B len BE, utf-8 bytes`.
 */
async function* readEventStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<EventStreamMessage> {
  const reader = body.getReader();
  let buf: Uint8Array = new Uint8Array(0);
  const decoder = new TextDecoder("utf-8");
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value) buf = concat(buf, value as Uint8Array);
      while (buf.length >= 4) {
        const totalLen = readU32(buf, 0);
        if (totalLen < 16 || totalLen > 16 * 1024 * 1024) {
          // Defensive: malformed length; bail out to avoid infinite loop.
          return;
        }
        if (buf.length < totalLen) break;
        const headersLen = readU32(buf, 4);
        const headersStart = 12;
        const payloadStart = headersStart + headersLen;
        const payloadEnd = totalLen - 4;
        const headers = parseEventStreamHeaders(buf.subarray(headersStart, payloadStart));
        const payload = decoder.decode(buf.subarray(payloadStart, payloadEnd));
        buf = buf.subarray(totalLen);
        yield { headers, payload };
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

function parseEventStreamHeaders(b: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  const decoder = new TextDecoder("utf-8");
  while (i < b.length) {
    const nameLen = b[i++];
    const name = decoder.decode(b.subarray(i, i + nameLen));
    i += nameLen;
    const type = b[i++];
    if (type === 7) {
      // STRING_VALUE
      const valLen = (b[i] << 8) | b[i + 1];
      i += 2;
      const val = decoder.decode(b.subarray(i, i + valLen));
      i += valLen;
      out[name] = val;
    } else {
      // Unsupported header type — skip remaining bytes of this header set;
      // we only need :event-type / :message-type which are always strings.
      break;
    }
  }
  return out;
}

function readU32(b: Uint8Array, o: number): number {
  return (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
