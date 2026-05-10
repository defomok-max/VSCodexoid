import { describe, expect, it } from "vitest";
import { z } from "zod";
import { runAgent } from "../src/core/agent/agentRunner";
import { ToolRegistry } from "../src/core/tools/toolRegistry";
import type { ToolDefinition } from "../src/core/tools/toolTypes";
import type { LLMProvider, ChatDelta } from "../src/core/providers/providerTypes";
import type { ModeProfile, NexusSettings, ProviderProfile, SkillDefinition } from "../src/core/../shared/types";

function fakeMode(): ModeProfile {
  return {
    id: "code",
    name: "Code",
    description: "code mode",
    systemPrompt: "You are a coding assistant.",
    allowedTools: ["echo"],
    reasoningEffort: "medium",
    approvalPolicy: "balanced",
    riskTolerance: "medium",
  };
}

function fakeSettings(): NexusSettings {
  return {
    defaultProviderId: "p",
    defaultModelId: "m",
    approvalPolicy: "balanced",
    reasoningEffort: "medium",
    enableMcp: false,
    enableSkills: false,
    enableBrowserTools: false,
    ui: { theme: "system", compactMode: false, animations: true },
    queue: { enabled: true, autoSendNext: true, allowInterrupt: true, preserveContext: true, summarizePreviousRun: true },
    checkpoints: { enabled: true, maxCount: 50 },
    ignorePatterns: [],
    customInstructions: "",
  };
}

function fakeProvider(deltas: ChatDelta[]): LLMProvider {
  const profile: ProviderProfile = {
    id: "p",
    name: "Fake",
    type: "openai-compatible",
    baseUrl: "https://example",
    defaultModel: "m",
    enabled: true,
  };
  return {
    id: "p",
    name: "Fake",
    type: "openai-compatible",
    profile,
    supportsTools: true,
    supportsVision: false,
    supportsReasoningEffort: false,
    supportsPromptCaching: false,
    supportsJsonMode: true,
    supportsComputerUse: false,
    async listModels() {
      return [];
    },
    async chat() {
      return { content: "" };
    },
    async *stream(): AsyncIterable<ChatDelta> {
      for (const d of deltas) yield d;
    },
  };
}

function fakeEchoTool(): ToolDefinition<{ text: string }> {
  return {
    id: "echo",
    name: "echo",
    description: "echo back",
    schema: z.object({ text: z.string() }),
    parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    riskLevel: "safe",
    category: "ui",
    async execute(args) {
      return { content: `echoed: ${args.text}` };
    },
  };
}

const noSkills: SkillDefinition[] = [];

describe("runAgent", () => {
  it("yields text deltas and ends naturally when no tool calls", async () => {
    const provider = fakeProvider([
      { type: "text", text: "hello " },
      { type: "text", text: "world" },
      { type: "finish", reason: "stop" },
    ]);
    const reg = new ToolRegistry();
    reg.register(fakeEchoTool());
    const events: string[] = [];
    const ctrl = new AbortController();
    for await (const ev of runAgent(
      {
        taskId: "t1",
        prompt: "hi",
        mode: fakeMode(),
        matchedSkills: noSkills,
        settings: fakeSettings(),
        provider,
        modelId: "m",
        policy: "balanced",
      },
      {
        toolRegistry: reg,
        ui: {
          showInfo: () => {},
          showWarning: () => {},
          showError: () => {},
          getSelection: async () => undefined,
          getOpenFiles: async () => [],
          askUser: async () => undefined,
        },
        security: {
          isIgnored: () => false,
          resolveWorkspacePath: (p) => p,
          scanSecrets: (s) => ({ redacted: s, matches: [] }),
        },
        checkpoints: {
          create: async () => ({ id: "cp_test", createdAt: Date.now(), files: [] }),
          restore: async () => 0,
          list: () => [],
        },
        flow: {
          setTodo: () => undefined,
          enqueue: () => ({ id: "q_test", createdAt: Date.now() }),
          recordSummary: () => undefined,
        },
        workspaceRoot: undefined,
        trusted: true,
        requestApproval: async (r) => ({ id: r.id, approved: true }),
      },
      ctrl.signal,
    )) {
      events.push(ev.type);
    }
    expect(events).toContain("task_start");
    expect(events).toContain("text_delta");
    expect(events).toContain("message_complete");
    expect(events).toContain("task_end");
  });

  it("executes a tool call and feeds the result back", async () => {
    const provider = fakeProvider([
      // Round 1: emits a tool call
      { type: "tool_call_start", id: "tc1", name: "echo" },
      { type: "tool_call_args", id: "tc1", argsDelta: '{"text":"hi"}' },
      { type: "finish", reason: "tool_calls" },
    ]);
    // Round 2 would normally happen — but our fake provider only yields once,
    // so the second iteration of the loop will re-call stream() and get an
    // empty stream, ending the run. We re-create the provider to return
    // a finish on the second call:
    const calls: ChatDelta[][] = [
      [
        { type: "tool_call_start", id: "tc1", name: "echo" },
        { type: "tool_call_args", id: "tc1", argsDelta: '{"text":"hi"}' },
        { type: "finish", reason: "tool_calls" },
      ],
      [{ type: "text", text: "done" }, { type: "finish", reason: "stop" }],
    ];
    let i = 0;
    provider.stream = (async function* () {
      const round = calls[i++] ?? [];
      for (const d of round) yield d;
    }) as LLMProvider["stream"];

    const reg = new ToolRegistry();
    reg.register(fakeEchoTool());
    const events: string[] = [];
    const ctrl = new AbortController();
    for await (const ev of runAgent(
      {
        taskId: "t2",
        prompt: "echo hi",
        mode: fakeMode(),
        matchedSkills: noSkills,
        settings: fakeSettings(),
        provider,
        modelId: "m",
        policy: "balanced",
      },
      {
        toolRegistry: reg,
        ui: {
          showInfo: () => {},
          showWarning: () => {},
          showError: () => {},
          getSelection: async () => undefined,
          getOpenFiles: async () => [],
          askUser: async () => undefined,
        },
        security: {
          isIgnored: () => false,
          resolveWorkspacePath: (p) => p,
          scanSecrets: (s) => ({ redacted: s, matches: [] }),
        },
        checkpoints: {
          create: async () => ({ id: "cp_test", createdAt: Date.now(), files: [] }),
          restore: async () => 0,
          list: () => [],
        },
        flow: {
          setTodo: () => undefined,
          enqueue: () => ({ id: "q_test", createdAt: Date.now() }),
          recordSummary: () => undefined,
        },
        workspaceRoot: undefined,
        trusted: true,
        requestApproval: async (r) => ({ id: r.id, approved: true }),
      },
      ctrl.signal,
    )) {
      events.push(ev.type);
    }
    expect(events).toContain("tool_call_start");
    expect(events).toContain("tool_call_end");
    expect(events).toContain("task_end");
  });

  it("rejects critical-risk tool when policy is balanced", async () => {
    const calls: ChatDelta[][] = [
      [
        { type: "tool_call_start", id: "tc1", name: "danger" },
        { type: "tool_call_args", id: "tc1", argsDelta: "{}" },
        { type: "finish", reason: "tool_calls" },
      ],
      [{ type: "text", text: "done" }, { type: "finish", reason: "stop" }],
    ];
    let i = 0;
    const provider = fakeProvider([]);
    provider.stream = (async function* () {
      const round = calls[i++] ?? [];
      for (const d of round) yield d;
    }) as LLMProvider["stream"];

    const reg = new ToolRegistry();
    reg.register({
      id: "danger",
      name: "danger",
      description: "critical tool",
      schema: z.object({}),
      parameters: { type: "object", properties: {} },
      riskLevel: "critical",
      category: "shell",
      async execute() {
        return { content: "executed" };
      },
    });

    const events: { type: string; ok?: boolean }[] = [];
    const mode = fakeMode();
    mode.allowedTools = ["danger"];
    const ctrl = new AbortController();
    for await (const ev of runAgent(
      {
        taskId: "t3",
        prompt: "do dangerous thing",
        mode,
        matchedSkills: noSkills,
        settings: fakeSettings(),
        provider,
        modelId: "m",
        policy: "balanced",
      },
      {
        toolRegistry: reg,
        ui: {
          showInfo: () => {},
          showWarning: () => {},
          showError: () => {},
          getSelection: async () => undefined,
          getOpenFiles: async () => [],
          askUser: async () => undefined,
        },
        security: {
          isIgnored: () => false,
          resolveWorkspacePath: (p) => p,
          scanSecrets: (s) => ({ redacted: s, matches: [] }),
        },
        checkpoints: {
          create: async () => ({ id: "cp_test", createdAt: Date.now(), files: [] }),
          restore: async () => 0,
          list: () => [],
        },
        flow: {
          setTodo: () => undefined,
          enqueue: () => ({ id: "q_test", createdAt: Date.now() }),
          recordSummary: () => undefined,
        },
        workspaceRoot: undefined,
        trusted: true,
        requestApproval: async (r) => ({ id: r.id, approved: true }),
      },
      ctrl.signal,
    )) {
      if (ev.type === "tool_call_end") events.push({ type: ev.type, ok: ev.ok });
      else events.push({ type: ev.type });
    }
    const end = events.find((e) => e.type === "tool_call_end");
    expect(end?.ok).toBe(false);
  });
});
