import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAICompatibleProvider } from "../src/core/providers/openaiCompatible";
import { AnthropicProvider } from "../src/core/providers/anthropic";
import { OllamaProvider } from "../src/core/providers/ollama";
import { GoogleGeminiProvider } from "../src/core/providers/googleGemini";
import { CustomHttpProvider } from "../src/core/providers/customHttp";
import { buildProvider, ProviderRegistry } from "../src/core/providers/providerRegistry";
import { pickPath, readSseEvents } from "../src/core/providers/util/sse";
import type { ProviderProfile } from "../src/shared/types";

const SYSTEM = { id: "s1", role: "system" as const, content: "you are helpful", ts: 0 };
const USER = { id: "u1", role: "user" as const, content: "hi there", ts: 1 };

function fakeSseResponse(events: string[]): Response {
  const body =
    events.map((e) => `data: ${e}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function fakeNdjson(lines: string[]): Response {
  return new Response(lines.join("\n") + "\n", { status: 200 });
}

beforeEach(() => {
  globalThis.fetch = vi.fn() as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("pickPath", () => {
  it("walks dotted paths", () => {
    expect(pickPath({ a: { b: [1, 2, 3] } }, "a.b[1]")).toBe(2);
    expect(pickPath({ a: 1 }, "a.b")).toBeUndefined();
    expect(pickPath({}, "")).toEqual({});
  });
});

describe("readSseEvents", () => {
  it("parses standard data: events and stops on [DONE]", async () => {
    const out: string[] = [];
    for await (const ev of readSseEvents(fakeSseResponse(['{"x":1}', '{"x":2}']))) {
      out.push(ev);
    }
    expect(out).toEqual(['{"x":1}', '{"x":2}']);
  });
});

describe("OpenAICompatibleProvider", () => {
  const profile: ProviderProfile = {
    id: "openai",
    name: "OpenAI",
    type: "openai-compatible",
    baseUrl: "https://api.openai.com",
    apiKeySecretRef: "openai",
    defaultModel: "gpt-4o-mini",
  };

  it("listModels returns ids", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ id: "gpt-4o-mini" }, { id: "gpt-4o" }] }), {
        status: 200,
      }),
    );
    const p = new OpenAICompatibleProvider(profile);
    const models = await p.listModels({ apiKey: "sk-x" });
    expect(models.map((m) => m.id)).toEqual(["gpt-4o-mini", "gpt-4o"]);
  });

  it("non-streaming chat returns parsed content + usage", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [
            { message: { content: "hello" }, finish_reason: "stop" },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
        { status: 200 },
      ),
    );
    const p = new OpenAICompatibleProvider(profile);
    const r = await p.chat(
      { model: "gpt-4o-mini", messages: [SYSTEM, USER] },
      { apiKey: "sk-x" },
    );
    expect(r.content).toBe("hello");
    expect(r.finishReason).toBe("stop");
    expect(r.usage?.inputTokens).toBe(10);
  });

  it("streaming yields text deltas + finish", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      fakeSseResponse([
        JSON.stringify({ choices: [{ delta: { content: "hel" } }] }),
        JSON.stringify({ choices: [{ delta: { content: "lo" } }] }),
        JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] }),
      ]),
    );
    const p = new OpenAICompatibleProvider(profile);
    const text: string[] = [];
    let finishReason: string | undefined;
    for await (const d of p.stream(
      { model: "gpt-4o-mini", messages: [USER] },
      { apiKey: "sk-x" },
    )) {
      if (d.type === "text") text.push(d.text);
      if (d.type === "finish") finishReason = d.reason;
    }
    expect(text.join("")).toBe("hello");
    expect(finishReason).toBe("stop");
  });

  it("Authorization header uses Bearer scheme", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), { status: 200 }),
    );
    const p = new OpenAICompatibleProvider(profile);
    await p.chat({ model: "gpt-4o-mini", messages: [USER] }, { apiKey: "sk-test" });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit & { headers: Record<string, string> };
    expect(init.headers.Authorization).toBe("Bearer sk-test");
  });
});

describe("AnthropicProvider", () => {
  const profile: ProviderProfile = {
    id: "anthropic",
    name: "Anthropic",
    type: "anthropic",
    baseUrl: "https://api.anthropic.com",
    defaultModel: "claude-3-5-sonnet-latest",
  };

  it("uses x-api-key header and concatenates system messages", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          content: [{ type: "text", text: "ok" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200 },
      ),
    );
    const p = new AnthropicProvider(profile);
    await p.chat({ model: "claude-3-5-sonnet-latest", messages: [SYSTEM, USER] }, { apiKey: "k" });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("k");
    expect(headers["anthropic-version"]).toBeDefined();
    const body = JSON.parse(init.body as string);
    expect(body.system).toContain("you are helpful");
    expect(Array.isArray(body.messages)).toBe(true);
  });

  it("listModels returns curated fallback list", async () => {
    const p = new AnthropicProvider(profile);
    const models = await p.listModels({ apiKey: "k" });
    expect(models.length).toBeGreaterThan(0);
    expect(models[0]?.id).toMatch(/claude/);
  });
});

describe("OllamaProvider", () => {
  it("listModels reads /api/tags", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ models: [{ name: "llama3.1" }, { name: "mistral" }] }), {
        status: 200,
      }),
    );
    const p = new OllamaProvider({
      id: "ollama",
      name: "Ollama",
      type: "ollama",
      baseUrl: "http://localhost:11434",
    });
    const models = await p.listModels({});
    expect(models.map((m) => m.id)).toEqual(["llama3.1", "mistral"]);
  });

  it("streaming parses NDJSON", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      fakeNdjson([
        JSON.stringify({ message: { role: "assistant", content: "he" } }),
        JSON.stringify({ message: { role: "assistant", content: "llo" } }),
        JSON.stringify({ done: true, prompt_eval_count: 3, eval_count: 4 }),
      ]),
    );
    const p = new OllamaProvider({
      id: "ollama",
      name: "Ollama",
      type: "ollama",
      baseUrl: "http://localhost:11434",
    });
    const text: string[] = [];
    let usage: { inputTokens?: number; outputTokens?: number } | undefined;
    for await (const d of p.stream({ model: "llama3.1", messages: [USER] }, {})) {
      if (d.type === "text") text.push(d.text);
      if (d.type === "usage") usage = d;
    }
    expect(text.join("")).toBe("hello");
    expect(usage?.inputTokens).toBe(3);
    expect(usage?.outputTokens).toBe(4);
  });
});

describe("GoogleGeminiProvider", () => {
  it("listModels filters to gemini ids", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          models: [
            { name: "models/gemini-1.5-pro" },
            { name: "models/text-bison-001" },
            { name: "models/gemini-2.0-flash" },
          ],
        }),
        { status: 200 },
      ),
    );
    const p = new GoogleGeminiProvider({
      id: "gemini",
      name: "Gemini",
      type: "google-gemini",
    });
    const models = await p.listModels({ apiKey: "k" });
    expect(models.map((m) => m.id)).toEqual(["gemini-1.5-pro", "gemini-2.0-flash"]);
  });
});

describe("CustomHttpProvider", () => {
  it("renders body template and extracts response by path", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ output: { text: "from-custom" } }), { status: 200 }),
    );
    const p = new CustomHttpProvider({
      id: "c1",
      name: "Custom",
      type: "custom-http",
      baseUrl: "https://example.test/v1/chat",
      customHttp: {
        method: "POST",
        bodyTemplate: '{ "model": ${model}, "input": ${prompt} }',
        responsePath: "output.text",
      },
    });
    const r = await p.chat({ model: "x", messages: [USER] }, { apiKey: "k" });
    expect(r.content).toBe("from-custom");
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({ model: "x", input: "hi there" });
  });
});

describe("ProviderRegistry", () => {
  it("returns the right adapter class for each profile type", () => {
    expect(buildProvider({ id: "1", name: "a", type: "anthropic" })).toBeInstanceOf(
      AnthropicProvider,
    );
    expect(buildProvider({ id: "2", name: "g", type: "google-gemini" })).toBeInstanceOf(
      GoogleGeminiProvider,
    );
    expect(buildProvider({ id: "3", name: "o", type: "ollama" })).toBeInstanceOf(OllamaProvider);
    expect(
      buildProvider({
        id: "4",
        name: "c",
        type: "custom-http",
        customHttp: { method: "POST", bodyTemplate: "{}", responsePath: "x" },
      }),
    ).toBeInstanceOf(CustomHttpProvider);
    expect(buildProvider({ id: "5", name: "x", type: "groq" })).toBeInstanceOf(
      OpenAICompatibleProvider,
    );
  });

  it("upserts and removes profiles", () => {
    const reg = new ProviderRegistry();
    reg.setProfiles([{ id: "a", name: "A", type: "openai-compatible" }]);
    expect(reg.list()).toHaveLength(1);
    reg.upsert({ id: "a", name: "A2", type: "openai-compatible" });
    expect(reg.list()[0].name).toBe("A2");
    reg.remove("a");
    expect(reg.list()).toHaveLength(0);
  });

  it("seeds default profiles", () => {
    const reg = new ProviderRegistry();
    expect(reg.defaultProfiles().some((p) => p.id === "openai")).toBe(true);
    expect(reg.defaultProfiles().some((p) => p.id === "ollama")).toBe(true);
  });
});
