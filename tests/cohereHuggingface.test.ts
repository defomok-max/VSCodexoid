import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CohereProvider } from "../src/core/providers/cohere";
import { HuggingFaceProvider } from "../src/core/providers/huggingface";
import { buildProvider } from "../src/core/providers/providerRegistry";
import type { ProviderProfile } from "../src/shared/types";

const SYSTEM = { id: "s1", role: "system" as const, content: "you are helpful", ts: 0 };
const USER = { id: "u1", role: "user" as const, content: "hi there", ts: 1 };
const TOOL_RESULT = {
  id: "t1",
  role: "tool" as const,
  content: "{\"ok\":true}",
  toolCallId: "call_1",
  ts: 2,
};

function fakeSseResponse(events: string[]): Response {
  const body = events.map((e) => `data: ${e}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

beforeEach(() => {
  globalThis.fetch = vi.fn() as unknown as typeof fetch;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("CohereProvider", () => {
  const profile: ProviderProfile = {
    id: "cohere",
    name: "Cohere",
    type: "cohere",
    baseUrl: "https://api.cohere.com",
    defaultModel: "command-a-03-2025",
  };

  it("buildProvider routes 'cohere' to CohereProvider", () => {
    const inst = buildProvider(profile);
    expect(inst).toBeInstanceOf(CohereProvider);
  });

  it("listModels falls back to a curated list when no key is supplied", async () => {
    const p = new CohereProvider(profile);
    const models = await p.listModels({});
    expect(models.map((m) => m.id)).toContain("command-a-03-2025");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("non-streaming chat parses /v2/chat shape and surfaces tool calls", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          message: {
            role: "assistant",
            content: [{ type: "text", text: "looking up" }],
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "read_file", arguments: '{"path":"a.ts"}' },
              },
            ],
          },
          finish_reason: "TOOL_CALL",
          usage: { tokens: { input_tokens: 12, output_tokens: 7 } },
        }),
        { status: 200 },
      ),
    );
    const p = new CohereProvider(profile);
    const r = await p.chat(
      { model: "command-a-03-2025", messages: [SYSTEM, USER] },
      { apiKey: "co-x" },
    );
    expect(r.content).toBe("looking up");
    expect(r.finishReason).toBe("tool_calls");
    expect(r.toolCalls).toEqual([
      { id: "call_1", name: "read_file", argsJson: '{"path":"a.ts"}' },
    ]);
    expect(r.usage).toEqual({ inputTokens: 12, outputTokens: 7 });

    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(url).toBe("https://api.cohere.com/v2/chat");
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit & { headers: Record<string, string> };
    expect(init.headers.Authorization).toBe("Bearer co-x");
  });

  it("translates a tool-result message into the tool role", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ message: { content: [{ type: "text", text: "ok" }] }, finish_reason: "COMPLETE" }),
        { status: 200 },
      ),
    );
    const p = new CohereProvider(profile);
    await p.chat(
      { model: "command-a-03-2025", messages: [USER, TOOL_RESULT] },
      { apiKey: "co-x" },
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit & { body: string };
    const body = JSON.parse(init.body);
    expect(body.messages[1]).toEqual({
      role: "tool",
      tool_call_id: "call_1",
      content: '{"ok":true}',
    });
  });

  it("streams content-delta + tool-call-start + message-end", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      fakeSseResponse([
        JSON.stringify({
          type: "content-delta",
          delta: { message: { content: { type: "text", text: "hel" } } },
        }),
        JSON.stringify({
          type: "content-delta",
          delta: { message: { content: { type: "text", text: "lo" } } },
        }),
        JSON.stringify({
          type: "tool-call-start",
          index: 0,
          delta: {
            message: {
              tool_calls: {
                id: "call_2",
                type: "function",
                function: { name: "grep", arguments: "" },
              },
            },
          },
        }),
        JSON.stringify({
          type: "tool-call-delta",
          index: 0,
          delta: {
            message: {
              tool_calls: { function: { arguments: '{"q":"foo"}' } },
            },
          },
        }),
        JSON.stringify({
          type: "message-end",
          delta: { finish_reason: "TOOL_CALL", usage: { tokens: { input_tokens: 5, output_tokens: 6 } } },
        }),
      ]),
    );
    const p = new CohereProvider(profile);
    const text: string[] = [];
    const args: string[] = [];
    let toolStartId: string | undefined;
    let finishReason: string | undefined;
    let inputTokens: number | undefined;
    for await (const d of p.stream(
      { model: "command-a-03-2025", messages: [USER] },
      { apiKey: "co-x" },
    )) {
      if (d.type === "text") text.push(d.text);
      if (d.type === "tool_call_start") toolStartId = d.id;
      if (d.type === "tool_call_args") args.push(d.argsDelta);
      if (d.type === "usage") inputTokens = d.inputTokens;
      if (d.type === "finish") finishReason = d.reason;
    }
    expect(text.join("")).toBe("hello");
    expect(toolStartId).toBe("call_2");
    expect(args.join("")).toBe('{"q":"foo"}');
    expect(finishReason).toBe("tool_calls");
    expect(inputTokens).toBe(5);
  });
});

describe("HuggingFaceProvider", () => {
  const profile: ProviderProfile = {
    id: "huggingface",
    name: "Hugging Face",
    type: "huggingface",
    baseUrl: "https://router.huggingface.co",
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct",
  };

  it("buildProvider routes 'huggingface' to HuggingFaceProvider", () => {
    const inst = buildProvider(profile);
    expect(inst).toBeInstanceOf(HuggingFaceProvider);
  });

  it("non-streaming chat parses /v1/chat/completions shape", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "hello world" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 4, completion_tokens: 2 },
        }),
        { status: 200 },
      ),
    );
    const p = new HuggingFaceProvider(profile);
    const r = await p.chat(
      { model: "meta-llama/Llama-3.3-70B-Instruct", messages: [USER] },
      { apiKey: "hf_x" },
    );
    expect(r.content).toBe("hello world");
    expect(r.finishReason).toBe("stop");
    expect(r.usage?.outputTokens).toBe(2);

    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(url).toBe("https://router.huggingface.co/v1/chat/completions");
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit & { headers: Record<string, string> };
    expect(init.headers.Authorization).toBe("Bearer hf_x");
  });

  it("listModels uses /v1/models and falls back when empty", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ id: "Qwen/Qwen2.5-Coder-32B-Instruct" }] }), { status: 200 }),
    );
    const p = new HuggingFaceProvider(profile);
    const models = await p.listModels({ apiKey: "hf_x" });
    expect(models.map((m) => m.id)).toEqual(["Qwen/Qwen2.5-Coder-32B-Instruct"]);

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );
    const fallback = await p.listModels({ apiKey: "hf_x" });
    expect(fallback.length).toBeGreaterThan(0);
  });

  it("streams text deltas + tool calls + usage", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      fakeSseResponse([
        JSON.stringify({ choices: [{ delta: { content: "he" } }] }),
        JSON.stringify({ choices: [{ delta: { content: "llo" } }] }),
        JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: "tc_1", function: { name: "grep", arguments: "" } },
                ],
              },
            },
          ],
        }),
        JSON.stringify({
          choices: [
            {
              delta: { tool_calls: [{ index: 0, function: { arguments: '{"q":"x"}' } }] },
            },
          ],
        }),
        JSON.stringify({
          choices: [{ delta: {}, finish_reason: "tool_calls" }],
          usage: { prompt_tokens: 3, completion_tokens: 9 },
        }),
      ]),
    );
    const p = new HuggingFaceProvider(profile);
    const text: string[] = [];
    const args: string[] = [];
    let toolId: string | undefined;
    let finishReason: string | undefined;
    let usageOut: number | undefined;
    for await (const d of p.stream(
      { model: "meta-llama/Llama-3.3-70B-Instruct", messages: [USER] },
      { apiKey: "hf_x" },
    )) {
      if (d.type === "text") text.push(d.text);
      if (d.type === "tool_call_start") toolId = d.id;
      if (d.type === "tool_call_args") args.push(d.argsDelta);
      if (d.type === "usage") usageOut = d.outputTokens;
      if (d.type === "finish") finishReason = d.reason;
    }
    expect(text.join("")).toBe("hello");
    expect(toolId).toBe("tc_1");
    expect(args.join("")).toBe('{"q":"x"}');
    expect(finishReason).toBe("tool_calls");
    expect(usageOut).toBe(9);
  });
});
