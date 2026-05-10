import type { ProviderProfile } from "../../shared/types";
import { OpenAICompatibleProvider } from "./openaiCompatible";
import { AnthropicProvider } from "./anthropic";
import { GoogleGeminiProvider } from "./googleGemini";
import { OllamaProvider } from "./ollama";
import { CustomHttpProvider } from "./customHttp";
import { BedrockProvider } from "./bedrock";
import { CohereProvider } from "./cohere";
import { HuggingFaceProvider } from "./huggingface";
import type { LLMProvider } from "./providerTypes";

/**
 * Maps a `ProviderProfile` to a concrete adapter. Many profile types (Groq,
 * DeepSeek, xAI, Together, Fireworks, Perplexity, Mistral, OpenRouter,
 * LM Studio, LocalAI, Azure OpenAI) are OpenAI-compatible — they all reuse
 * `OpenAICompatibleProvider` and just differ in `baseUrl` / model id.
 *
 * AWS Bedrock has a dedicated SigV4-signed adapter (`BedrockProvider`) using
 * the unified Converse / ConverseStream APIs. Cohere uses its native v2
 * chat API (`CohereProvider`); Hugging Face uses the Inference Router
 * (`HuggingFaceProvider`).
 */
export function buildProvider(profile: ProviderProfile): LLMProvider {
  switch (profile.type) {
    case "anthropic":
      return new AnthropicProvider(profile);
    case "google-gemini":
      return new GoogleGeminiProvider(profile);
    case "ollama":
      return new OllamaProvider(profile);
    case "custom-http":
      return new CustomHttpProvider(profile);
    case "aws-bedrock":
      return new BedrockProvider(profile);
    case "cohere":
      return new CohereProvider(profile);
    case "huggingface":
      return new HuggingFaceProvider(profile);
    case "openai-compatible":
    case "openrouter":
    case "groq":
    case "mistral":
    case "deepseek":
    case "xai":
    case "together":
    case "fireworks":
    case "perplexity":
    case "lm-studio":
    case "localai":
    case "azure-openai":
      return new OpenAICompatibleProvider(profile);
  }
}

export class ProviderRegistry {
  private profiles = new Map<string, ProviderProfile>();
  private cache = new Map<string, LLMProvider>();

  setProfiles(profiles: ProviderProfile[]): void {
    this.profiles.clear();
    this.cache.clear();
    for (const p of profiles) this.profiles.set(p.id, p);
  }

  upsert(profile: ProviderProfile): void {
    this.profiles.set(profile.id, profile);
    this.cache.delete(profile.id);
  }

  remove(id: string): void {
    this.profiles.delete(id);
    this.cache.delete(id);
  }

  list(): ProviderProfile[] {
    return [...this.profiles.values()];
  }

  get(id: string): LLMProvider | undefined {
    const profile = this.profiles.get(id);
    if (!profile) return undefined;
    let inst = this.cache.get(id);
    if (!inst) {
      inst = buildProvider(profile);
      this.cache.set(id, inst);
    }
    return inst;
  }

  defaultProfiles(): ProviderProfile[] {
    return DEFAULT_PROFILES;
  }
}

/**
 * Out-of-the-box profile suggestions. The user can edit / extend / delete.
 * API keys are NOT included — they are added via the Providers UI and stored
 * in `SecretStorage`.
 */
export const DEFAULT_PROFILES: ProviderProfile[] = [
  {
    id: "openai",
    name: "OpenAI",
    type: "openai-compatible",
    baseUrl: "https://api.openai.com",
    apiKeySecretRef: "openai",
    defaultModel: "gpt-4o-mini",
    streaming: true,
    toolCallingFormat: "openai",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    type: "anthropic",
    baseUrl: "https://api.anthropic.com",
    apiKeySecretRef: "anthropic",
    defaultModel: "claude-3-5-sonnet-latest",
    streaming: true,
    toolCallingFormat: "anthropic",
  },
  {
    id: "gemini",
    name: "Google Gemini",
    type: "google-gemini",
    baseUrl: "https://generativelanguage.googleapis.com",
    apiKeySecretRef: "gemini",
    defaultModel: "gemini-1.5-pro-latest",
    streaming: true,
    toolCallingFormat: "gemini",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    type: "openrouter",
    baseUrl: "https://openrouter.ai/api",
    apiKeySecretRef: "openrouter",
    defaultModel: "anthropic/claude-3.5-sonnet",
    streaming: true,
    toolCallingFormat: "openai",
  },
  {
    id: "groq",
    name: "Groq",
    type: "groq",
    baseUrl: "https://api.groq.com/openai",
    apiKeySecretRef: "groq",
    defaultModel: "llama-3.3-70b-versatile",
    streaming: true,
    toolCallingFormat: "openai",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    type: "deepseek",
    baseUrl: "https://api.deepseek.com",
    apiKeySecretRef: "deepseek",
    defaultModel: "deepseek-chat",
    streaming: true,
    toolCallingFormat: "openai",
  },
  {
    id: "xai",
    name: "xAI",
    type: "xai",
    baseUrl: "https://api.x.ai",
    apiKeySecretRef: "xai",
    defaultModel: "grok-2-latest",
    streaming: true,
    toolCallingFormat: "openai",
  },
  {
    id: "mistral",
    name: "Mistral",
    type: "mistral",
    baseUrl: "https://api.mistral.ai",
    apiKeySecretRef: "mistral",
    defaultModel: "mistral-large-latest",
    streaming: true,
    toolCallingFormat: "openai",
  },
  {
    id: "together",
    name: "Together AI",
    type: "together",
    baseUrl: "https://api.together.xyz",
    apiKeySecretRef: "together",
    defaultModel: "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo",
    streaming: true,
    toolCallingFormat: "openai",
  },
  {
    id: "fireworks",
    name: "Fireworks AI",
    type: "fireworks",
    baseUrl: "https://api.fireworks.ai/inference",
    apiKeySecretRef: "fireworks",
    defaultModel: "accounts/fireworks/models/llama-v3p1-70b-instruct",
    streaming: true,
    toolCallingFormat: "openai",
  },
  {
    id: "perplexity",
    name: "Perplexity",
    type: "perplexity",
    baseUrl: "https://api.perplexity.ai",
    apiKeySecretRef: "perplexity",
    defaultModel: "llama-3.1-sonar-large-128k-online",
    streaming: true,
    toolCallingFormat: "openai",
  },
  {
    id: "ollama",
    name: "Ollama (local)",
    type: "ollama",
    baseUrl: "http://localhost:11434",
    defaultModel: "llama3.1",
    streaming: true,
  },
  {
    id: "lm-studio",
    name: "LM Studio (local)",
    type: "lm-studio",
    baseUrl: "http://localhost:1234",
    defaultModel: "local-model",
    streaming: true,
    toolCallingFormat: "openai",
  },
  {
    id: "localai",
    name: "LocalAI",
    type: "localai",
    baseUrl: "http://localhost:8080",
    defaultModel: "local-model",
    streaming: true,
    toolCallingFormat: "openai",
  },
  {
    id: "aws-bedrock",
    name: "AWS Bedrock",
    type: "aws-bedrock",
    baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com",
    apiKeySecretRef: "aws-bedrock",
    defaultModel: "anthropic.claude-3-5-sonnet-20241022-v2:0",
    streaming: true,
  },
  {
    id: "cohere",
    name: "Cohere",
    type: "cohere",
    baseUrl: "https://api.cohere.com",
    apiKeySecretRef: "cohere",
    defaultModel: "command-a-03-2025",
    streaming: true,
    toolCallingFormat: "openai",
  },
  {
    id: "huggingface",
    name: "Hugging Face",
    type: "huggingface",
    baseUrl: "https://router.huggingface.co",
    apiKeySecretRef: "huggingface",
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct",
    streaming: true,
    toolCallingFormat: "openai",
  },
];
