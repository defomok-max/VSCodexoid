import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderProfile } from "../src/shared/types";
import {
  buildEmbeddingsProvider,
  GeminiEmbeddingsProvider,
  OllamaEmbeddingsProvider,
  OpenAICompatibleEmbeddingsProvider,
} from "../src/core/providers/embeddingsAdapters";
import { EmbeddingsProviderError } from "../src/core/providers/embeddingsProvider";

interface FetchCall {
  url: string;
  init: RequestInit;
}

function profile(overrides: Partial<ProviderProfile>): ProviderProfile {
  return {
    id: overrides.id ?? "p",
    name: overrides.name ?? "p",
    type: overrides.type ?? "openai-compatible",
    baseUrl: overrides.baseUrl,
    headers: overrides.headers,
    organization: overrides.organization,
    project: overrides.project,
  } as ProviderProfile;
}

let calls: FetchCall[] = [];
let nextResponses: Array<{ ok: boolean; status?: number; statusText?: string; body: unknown }> = [];
const originalFetch = globalThis.fetch;

beforeEach(() => {
  calls = [];
  nextResponses = [];
  globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const r = nextResponses.shift();
    if (!r) throw new Error(`unexpected fetch ${String(url)}`);
    return new Response(JSON.stringify(r.body), {
      status: r.status ?? (r.ok ? 200 : 500),
      statusText: r.statusText ?? (r.ok ? "OK" : "ERR"),
    });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("OpenAICompatibleEmbeddingsProvider", () => {
  it("hits /v1/embeddings with model+input and Authorization header", async () => {
    const adapter = new OpenAICompatibleEmbeddingsProvider(
      profile({ id: "openai", baseUrl: "https://api.openai.com" }),
      "text-embedding-3-small",
    );
    nextResponses.push({
      ok: true,
      body: { data: [{ index: 0, embedding: [1, 0, 0] }, { index: 1, embedding: [0, 1, 0] }] },
    });
    const out = await adapter.embed(["hello", "world"], { apiKey: "sk-test" });
    expect(out).toEqual([[1, 0, 0], [0, 1, 0]]);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.openai.com/v1/embeddings");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-test");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      model: "text-embedding-3-small",
      input: ["hello", "world"],
    });
  });

  it("re-orders results by index when the provider returns them shuffled", async () => {
    const adapter = new OpenAICompatibleEmbeddingsProvider(
      profile({ id: "p" }),
      "m",
    );
    nextResponses.push({
      ok: true,
      body: {
        data: [
          { index: 1, embedding: [9, 9] },
          { index: 0, embedding: [1, 1] },
        ],
      },
    });
    const out = await adapter.embed(["a", "b"], {});
    expect(out).toEqual([[1, 1], [9, 9]]);
  });

  it("uses 'api-key' header for azure-openai profiles", async () => {
    const adapter = new OpenAICompatibleEmbeddingsProvider(
      profile({ id: "az", type: "azure-openai", baseUrl: "https://az.example.com" }),
      "m",
    );
    nextResponses.push({ ok: true, body: { data: [{ index: 0, embedding: [1] }] } });
    await adapter.embed(["x"], { apiKey: "k" });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["api-key"]).toBe("k");
    expect(headers.Authorization).toBeUndefined();
  });

  it("throws EmbeddingsProviderError on non-2xx", async () => {
    const adapter = new OpenAICompatibleEmbeddingsProvider(profile({ id: "p" }), "m");
    nextResponses.push({ ok: false, status: 401, statusText: "Unauthorized", body: { error: "bad-key" } });
    await expect(adapter.embed(["x"], {})).rejects.toBeInstanceOf(EmbeddingsProviderError);
  });
});

describe("OllamaEmbeddingsProvider", () => {
  it("uses /api/embed for batched calls", async () => {
    const adapter = new OllamaEmbeddingsProvider(
      profile({ id: "ollama", type: "ollama", baseUrl: "http://localhost:11434" }),
      "nomic-embed-text",
    );
    nextResponses.push({ ok: true, body: { embeddings: [[1, 2], [3, 4]] } });
    const out = await adapter.embed(["a", "b"], {});
    expect(out).toEqual([[1, 2], [3, 4]]);
    expect(calls[0].url).toBe("http://localhost:11434/api/embed");
    expect(adapter.dimensions).toBe(2);
  });

  it("falls back to legacy /api/embeddings on 404", async () => {
    const adapter = new OllamaEmbeddingsProvider(
      profile({ id: "ollama", type: "ollama" }),
      "m",
    );
    nextResponses.push({ ok: false, status: 404, body: {} });
    nextResponses.push({ ok: true, body: { embedding: [1, 2, 3] } });
    nextResponses.push({ ok: true, body: { embedding: [4, 5, 6] } });
    const out = await adapter.embed(["a", "b"], {});
    expect(out).toEqual([[1, 2, 3], [4, 5, 6]]);
    expect(calls).toHaveLength(3);
    expect(calls[1].url).toMatch(/\/api\/embeddings$/);
  });

  it("propagates non-404 server errors", async () => {
    const adapter = new OllamaEmbeddingsProvider(profile({ id: "ollama", type: "ollama" }), "m");
    nextResponses.push({ ok: false, status: 500, body: {} });
    await expect(adapter.embed(["x"], {})).rejects.toBeInstanceOf(EmbeddingsProviderError);
  });
});

describe("GeminiEmbeddingsProvider", () => {
  it("posts to :batchEmbedContents with the API key in the URL", async () => {
    const adapter = new GeminiEmbeddingsProvider(
      profile({ id: "gemini", type: "google-gemini" }),
      "text-embedding-004",
    );
    nextResponses.push({ ok: true, body: { embeddings: [{ values: [1, 0] }, { values: [0, 1] }] } });
    const out = await adapter.embed(["foo", "bar"], { apiKey: "my-key" });
    expect(out).toEqual([[1, 0], [0, 1]]);
    expect(calls[0].url).toContain("/models/text-embedding-004:batchEmbedContents");
    expect(calls[0].url).toContain("key=my-key");
    const body = JSON.parse(calls[0].init.body as string) as { requests: { content: { parts: { text: string }[] } }[] };
    expect(body.requests).toHaveLength(2);
    expect(body.requests[0].content.parts[0].text).toBe("foo");
  });

  it("throws when no API key is provided", async () => {
    const adapter = new GeminiEmbeddingsProvider(
      profile({ id: "gemini", type: "google-gemini" }),
      "m",
    );
    await expect(adapter.embed(["x"], {})).rejects.toBeInstanceOf(EmbeddingsProviderError);
  });
});

describe("buildEmbeddingsProvider", () => {
  it("dispatches by profile.type, defaulting to OpenAI-compatible", () => {
    const a = buildEmbeddingsProvider({ profile: profile({ id: "a", type: "ollama" }), model: "m" });
    expect(a).toBeInstanceOf(OllamaEmbeddingsProvider);
    const b = buildEmbeddingsProvider({ profile: profile({ id: "b", type: "google-gemini" }), model: "m" });
    expect(b).toBeInstanceOf(GeminiEmbeddingsProvider);
    const c = buildEmbeddingsProvider({ profile: profile({ id: "c", type: "openai-compatible" }), model: "m" });
    expect(c).toBeInstanceOf(OpenAICompatibleEmbeddingsProvider);
    // Unknown types default to OpenAI-compatible.
    const d = buildEmbeddingsProvider({ profile: profile({ id: "d", type: "custom-http" }), model: "m" });
    expect(d).toBeInstanceOf(OpenAICompatibleEmbeddingsProvider);
  });
});
