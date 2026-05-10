import type { ProviderProfile } from "../../../shared/types";
import type { EmbeddingsProvider } from "../embeddingsProvider";
import { OpenAICompatibleEmbeddingsProvider } from "./openaiCompatibleEmbeddings";
import { OllamaEmbeddingsProvider } from "./ollamaEmbeddings";
import { GeminiEmbeddingsProvider } from "./geminiEmbeddings";

export interface BuildEmbeddingsProviderOptions {
  profile: ProviderProfile;
  model: string;
  dimensions?: number;
}

/**
 * Pick the right adapter for the given provider profile. Always returns an
 * adapter — for unknown provider types we default to the OpenAI-compatible
 * shape (which covers the long tail of self-hosted endpoints, OpenRouter,
 * and the various OpenAI clones).
 */
export function buildEmbeddingsProvider(
  opts: BuildEmbeddingsProviderOptions,
): EmbeddingsProvider {
  const { profile, model, dimensions } = opts;
  switch (profile.type) {
    case "ollama":
      return new OllamaEmbeddingsProvider(profile, model);
    case "google-gemini":
      return new GeminiEmbeddingsProvider(profile, model, dimensions);
    default:
      return new OpenAICompatibleEmbeddingsProvider(profile, model, dimensions);
  }
}

export {
  OpenAICompatibleEmbeddingsProvider,
  OllamaEmbeddingsProvider,
  GeminiEmbeddingsProvider,
};
