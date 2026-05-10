import type { ProviderProfile } from "../../shared/types";

/**
 * Minimal interface every embeddings adapter must implement. Mirrors the shape
 * of `LLMProvider` but covers only the embeddings endpoint, kept intentionally
 * small so adapters stay one-file each.
 *
 * Implementations must:
 *   - return one vector per input string in `texts`, in the same order;
 *   - propagate `signal` for cancellation;
 *   - return `dimensions` consistent across calls (vectors must all have the
 *     same length so cosine similarity is well-defined for the index).
 */
export interface EmbeddingsProvider {
  readonly id: string;
  readonly model: string;
  readonly dimensions: number | undefined;
  embed(
    texts: string[],
    opts: { apiKey?: string; signal?: AbortSignal },
  ): Promise<number[][]>;
}

export interface EmbeddingsProviderConstructorArgs {
  profile: ProviderProfile;
  model: string;
}

export class EmbeddingsProviderError extends Error {
  constructor(
    message: string,
    public readonly providerId: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "EmbeddingsProviderError";
  }
}
