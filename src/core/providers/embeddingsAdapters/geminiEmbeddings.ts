import type { ProviderProfile } from "../../../shared/types";
import { EmbeddingsProviderError, type EmbeddingsProvider } from "../embeddingsProvider";

/**
 * Google Gemini embeddings adapter. Uses
 * `:batchEmbedContents?key=...` for batched calls; falls back to per-text
 * `:embedContent` if batch is not available.
 *
 * Default base URL: `https://generativelanguage.googleapis.com/v1beta`.
 */
export class GeminiEmbeddingsProvider implements EmbeddingsProvider {
  readonly id: string;
  readonly model: string;
  dimensions: number | undefined;

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
    return (
      this.profile.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta"
    ).replace(/\/$/, "");
  }

  async embed(
    texts: string[],
    opts: { apiKey?: string; signal?: AbortSignal },
  ): Promise<number[][]> {
    if (texts.length === 0) return [];
    if (!opts.apiKey) {
      throw new EmbeddingsProviderError("missing Gemini API key", this.id);
    }
    const url = `${this.baseUrl}/models/${this.model}:batchEmbedContents?key=${encodeURIComponent(
      opts.apiKey,
    )}`;
    const requests = texts.map((t) => ({
      model: `models/${this.model}`,
      content: { parts: [{ text: t }] },
      ...(this.dimensions !== undefined ? { outputDimensionality: this.dimensions } : {}),
    }));
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.profile.headers },
      body: JSON.stringify({ requests }),
      signal: opts.signal,
    });
    if (!res.ok) {
      throw new EmbeddingsProviderError(
        `embeddings failed: ${res.status} ${res.statusText}`,
        this.id,
        res.status,
      );
    }
    const json = (await res.json()) as { embeddings?: { values: number[] }[] };
    if (!Array.isArray(json.embeddings) || json.embeddings.length !== texts.length) {
      throw new EmbeddingsProviderError(
        `expected ${texts.length} embeddings, got ${json.embeddings?.length ?? 0}`,
        this.id,
      );
    }
    const out = json.embeddings.map((e) => e.values);
    this.dimensions = out[0]?.length ?? this.dimensions;
    return out;
  }
}
