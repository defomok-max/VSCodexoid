import type {
  ChatMessage,
  ModelInfo,
  ProviderProfile,
  ReasoningEffort,
} from "../../shared/types";

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  /**
   * Optional tool / function definitions in OpenAI's `tools[]` shape. Adapters
   * translate to provider-specific formats.
   */
  tools?: ChatTool[];
  toolChoice?: "auto" | "none" | "required" | { name: string };
  temperature?: number;
  maxOutputTokens?: number;
  reasoningEffort?: ReasoningEffort;
  stream?: boolean;
  /** AbortSignal so callers can cancel an in-flight request. */
  signal?: AbortSignal;
  /** Provider-specific extras forwarded as-is. */
  extra?: Record<string, unknown>;
}

export interface ChatTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatToolCall {
  id: string;
  name: string;
  argsJson: string;
}

export interface ChatResponse {
  content: string;
  toolCalls?: ChatToolCall[];
  finishReason?: "stop" | "length" | "tool_calls" | "content_filter" | "error";
  usage?: { inputTokens?: number; outputTokens?: number };
  reasoningSummary?: string;
}

export type ChatDelta =
  | { type: "text"; text: string }
  | { type: "tool_call_start"; id: string; name: string }
  | { type: "tool_call_args"; id: string; argsDelta: string }
  | { type: "reasoning"; text: string }
  | { type: "usage"; inputTokens?: number; outputTokens?: number }
  | { type: "finish"; reason?: ChatResponse["finishReason"] }
  | { type: "error"; message: string };

export interface LLMProvider {
  readonly id: string;
  readonly name: string;
  readonly type: ProviderProfile["type"];
  readonly profile: ProviderProfile;

  listModels(opts: { apiKey?: string }): Promise<ModelInfo[]>;
  chat(req: ChatRequest, opts: { apiKey?: string }): Promise<ChatResponse>;
  stream(req: ChatRequest, opts: { apiKey?: string }): AsyncIterable<ChatDelta>;

  readonly supportsTools: boolean;
  readonly supportsVision: boolean;
  readonly supportsReasoningEffort: boolean;
  readonly supportsPromptCaching: boolean;
  readonly supportsJsonMode: boolean;
  readonly supportsComputerUse: boolean;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly providerId: string,
    public readonly status?: number,
    public readonly code?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
