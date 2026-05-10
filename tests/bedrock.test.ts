import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BedrockProvider } from "../src/core/providers/bedrock";
import { buildProvider } from "../src/core/providers/providerRegistry";
import type { ProviderProfile } from "../src/shared/types";

const PROFILE: ProviderProfile = {
  id: "bedrock",
  name: "AWS Bedrock",
  type: "aws-bedrock",
  baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com",
  apiKeySecretRef: "aws-bedrock",
  defaultModel: "anthropic.claude-3-5-sonnet-20241022-v2:0",
  streaming: true,
};

const CREDS_JSON = JSON.stringify({
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
});

describe("providerRegistry \u2014 aws-bedrock dispatch", () => {
  it("aws-bedrock profiles map to BedrockProvider", () => {
    const provider = buildProvider(PROFILE);
    expect(provider).toBeInstanceOf(BedrockProvider);
    expect(provider.id).toBe("bedrock");
    expect(provider.supportsTools).toBe(true);
  });
});

describe("BedrockProvider.chat", () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("signs the Converse request, builds the right URL and body, and parses the response", async () => {
    const captured: { url: string; init?: RequestInit } = { url: "" };
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.url = typeof input === "string" ? input : input.toString();
      captured.init = init;
      return new Response(
        JSON.stringify({
          output: {
            message: {
              role: "assistant",
              content: [
                { text: "Hello from Bedrock" },
                {
                  toolUse: {
                    toolUseId: "tu-1",
                    name: "search",
                    input: { query: "rust" },
                  },
                },
              ],
            },
          },
          stopReason: "tool_use",
          usage: { inputTokens: 12, outputTokens: 7 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof globalThis.fetch;

    const provider = new BedrockProvider(PROFILE);
    const res = await provider.chat(
      {
        model: "anthropic.claude-3-5-sonnet-20241022-v2:0",
        messages: [
          { id: "1", role: "system", content: "be brief", ts: 0 },
          { id: "2", role: "user", content: "hi", ts: 0 },
        ],
        tools: [
          {
            name: "search",
            description: "Search the web",
            parameters: { type: "object", properties: { q: { type: "string" } } },
          },
        ],
        toolChoice: "auto",
        maxOutputTokens: 256,
        temperature: 0.5,
      },
      { apiKey: CREDS_JSON },
    );

    expect(res.content).toBe("Hello from Bedrock");
    expect(res.toolCalls).toEqual([
      { id: "tu-1", name: "search", argsJson: JSON.stringify({ query: "rust" }) },
    ]);
    expect(res.finishReason).toBe("tool_calls");
    expect(res.usage).toEqual({ inputTokens: 12, outputTokens: 7 });

    expect(captured.url).toBe(
      "https://bedrock-runtime.us-east-1.amazonaws.com/model/anthropic.claude-3-5-sonnet-20241022-v2%3A0/converse",
    );

    const headers = new Headers(captured.init?.headers as HeadersInit);
    expect(headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\//);
    expect(headers.get("authorization")).toMatch(/\/us-east-1\/bedrock\/aws4_request/);
    expect(headers.get("x-amz-date")).toMatch(/^\d{8}T\d{6}Z$/);

    const body = JSON.parse(captured.init?.body as string);
    expect(body.system).toEqual([{ text: "be brief" }]);
    expect(body.messages).toEqual([
      { role: "user", content: [{ text: "hi" }] },
    ]);
    expect(body.toolConfig.tools[0].toolSpec.name).toBe("search");
    expect(body.toolConfig.toolChoice).toEqual({ auto: {} });
    expect(body.inferenceConfig).toEqual({ maxTokens: 256, temperature: 0.5 });
  });

  it("throws ProviderError on non-2xx", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response("forbidden", { status: 403, statusText: "Forbidden" }),
    ) as unknown as typeof globalThis.fetch;

    const provider = new BedrockProvider(PROFILE);
    await expect(
      provider.chat(
        { model: "anthropic.claude-3-5-sonnet-20241022-v2:0", messages: [] },
        { apiKey: CREDS_JSON },
      ),
    ).rejects.toThrow(/403/);
  });

  it("throws if credentials are missing entirely", async () => {
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    const provider = new BedrockProvider(PROFILE);
    await expect(
      provider.chat({ model: "x", messages: [] }, { apiKey: undefined }),
    ).rejects.toThrow(/accessKeyId/);
  });

  it("translates assistant tool calls and tool results into Bedrock's format", async () => {
    const captured: { init?: RequestInit } = {};
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured.init = init;
      return new Response(
        JSON.stringify({
          output: { message: { role: "assistant", content: [{ text: "ok" }] } },
          stopReason: "end_turn",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof globalThis.fetch;

    const provider = new BedrockProvider(PROFILE);
    await provider.chat(
      {
        model: "anthropic.claude-3-5-sonnet-20241022-v2:0",
        messages: [
          { id: "u", role: "user", content: "find rust", ts: 0 },
          {
            id: "a",
            role: "assistant",
            content: "let me search",
            ts: 0,
            toolCalls: [{ id: "tu-1", name: "search", argsJson: JSON.stringify({ q: "rust" }) }],
          },
          { id: "t", role: "tool", content: "results: ...", ts: 0, toolCallId: "tu-1" },
        ],
      },
      { apiKey: CREDS_JSON },
    );

    const body = JSON.parse(captured.init?.body as string);
    expect(body.messages).toEqual([
      { role: "user", content: [{ text: "find rust" }] },
      {
        role: "assistant",
        content: [
          { text: "let me search" },
          { toolUse: { toolUseId: "tu-1", name: "search", input: { q: "rust" } } },
        ],
      },
      {
        role: "user",
        content: [
          {
            toolResult: {
              toolUseId: "tu-1",
              content: [{ text: "results: ..." }],
              status: "success",
            },
          },
        ],
      },
    ]);
  });
});
