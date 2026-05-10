import type { ProviderProfile } from "../../../shared/types";
import { EmbeddingsProviderError, type EmbeddingsProvider } from "../embeddingsProvider";

/**
 * OpenAI-compatible `/v1/embeddings` adapter. Used by OpenAI itself and any
 * provider that mirrors that shape (Voyage, Mistral, Together, Fireworks,
 * Groq, OpenRouter, etc). Azure OpenAI uses an `api-key` header and a
 * deployment-shaped base URL, set via the profile.
 */
export class OpenAICompatibleEmbeddingsProvider implements EmbeddingsProvider {
  readonly id: string;
  readonly model: string;
  readonly dimensions: number | undefined;

  constructor(
    public readonly profile: ProviderProfile,
    model: string,
    dimensions?: number,
  ) {
    this.id = profile.id;
    this.model = model;
    this.dimensions = dimensions;
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
      const useApiKeyHeader = !!h["api-key"] || this.profile.type === "azure-openai";
      if (useApiKeyHeader) h["api-key"] = apiKey;
      else h["Authorization"] = `Bearer ${apiKey}`;
    }
    if (this.profile.organization) h["OpenAI-Organization"] = this.profile.organization;
    if (this.profile.project) h["OpenAI-Project"] = this.profile.project;
    return h;
  }

  async embed(
    texts: string[],
    opts: { apiKey?: string; signal?: AbortSignal },
  ): Promise<number[][]> {
    if (texts.length === 0) return [];
    const body: Record<string, unknown> = { model: this.model, input: texts };
    if (this.dimensions !== undefined) body.dimensions = this.dimensions;
    const res = await fetch(`${this.baseUrl}/v1/embeddings`, {
      method: "POST",
      headers: this.buildHeaders(opts.apiKey),
      body: JSON.stringify(body),
      signal: opts.signal,
    });
    if (!res.ok) {
      const text = await safeText(res);
      throw new EmbeddingsProviderError(
        `embeddings failed: ${res.status} ${res.statusText}: ${text}`,
        this.id,
        res.status,
      );
    }
    const json = (await res.json()) as OpenAIEmbeddingsResponse;
    if (!json.data || !Array.isArray(json.data)) {
      throw new EmbeddingsProviderError("unexpected embeddings response shape", this.id);
    }
    const sorted = [...json.data].sort((a, b) => a.index - b.index);
    if (sorted.length !== texts.length) {
      throw new EmbeddingsProviderError(
        `expected ${texts.length} embeddings, got ${sorted.length}`,
        this.id,
      );
    }
    return sorted.map((d) => d.embedding);
  }
}

interface OpenAIEmbeddingsResponse {
  data: { index: number; embedding: number[] }[];
  model?: string;
  usage?: { prompt_tokens?: number; total_tokens?: number };
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "";
  }
}
