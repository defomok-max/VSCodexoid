import type { ProviderProfile } from "../../../shared/types";
import { EmbeddingsProviderError, type EmbeddingsProvider } from "../embeddingsProvider";

/**
 * Ollama-native embeddings adapter. Uses Ollama's `/api/embed` endpoint
 * (introduced in 0.1.45+, which accepts `input` as a string or array). For
 * older Ollama versions the legacy `/api/embeddings` shape (single `prompt`)
 * is also supported as a fallback.
 *
 * `dimensions` is reported by the model itself, so this adapter does not
 * require a dimensions hint up front; the first successful response sets it.
 */
export class OllamaEmbeddingsProvider implements EmbeddingsProvider {
  readonly id: string;
  readonly model: string;
  /** Set lazily after the first successful response. */
  dimensions: number | undefined;

  constructor(public readonly profile: ProviderProfile, model: string) {
    this.id = profile.id;
    this.model = model;
  }

  private get baseUrl(): string {
    return (this.profile.baseUrl ?? "http://localhost:11434").replace(/\/$/, "");
  }

  async embed(
    texts: string[],
    opts: { signal?: AbortSignal },
  ): Promise<number[][]> {
    if (texts.length === 0) return [];
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.profile.headers,
    };
    // Try the modern batched endpoint first.
    const res = await fetch(`${this.baseUrl}/api/embed`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: this.model, input: texts }),
      signal: opts.signal,
    });
    if (res.ok) {
      const json = (await res.json()) as { embeddings?: number[][] };
      if (!Array.isArray(json.embeddings) || json.embeddings.length !== texts.length) {
        throw new EmbeddingsProviderError(
          `expected ${texts.length} embeddings, got ${json.embeddings?.length ?? 0}`,
          this.id,
        );
      }
      this.dimensions = json.embeddings[0]?.length ?? this.dimensions;
      return json.embeddings;
    }
    if (res.status !== 404 && res.status !== 405) {
      throw new EmbeddingsProviderError(
        `embeddings failed: ${res.status} ${res.statusText}`,
        this.id,
        res.status,
      );
    }
    // Legacy fallback: `/api/embeddings` with a single `prompt`. Loop, since
    // the legacy endpoint accepts only one input per call.
    const out: number[][] = [];
    for (const t of texts) {
      const r = await fetch(`${this.baseUrl}/api/embeddings`, {
        method: "POST",
        headers,
        body: JSON.stringify({ model: this.model, prompt: t }),
        signal: opts.signal,
      });
      if (!r.ok) {
        throw new EmbeddingsProviderError(
          `embeddings (legacy) failed: ${r.status} ${r.statusText}`,
          this.id,
          r.status,
        );
      }
      const json = (await r.json()) as { embedding?: number[] };
      if (!Array.isArray(json.embedding)) {
        throw new EmbeddingsProviderError("missing 'embedding' in legacy response", this.id);
      }
      out.push(json.embedding);
    }
    this.dimensions = out[0]?.length ?? this.dimensions;
    return out;
  }
}
