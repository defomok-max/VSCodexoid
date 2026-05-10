import { describe, expect, it } from "vitest";
import {
  aggregateUsage,
  costForTask,
  formatTokens,
  formatUsd,
  pricingFor,
} from "../src/webview/components/Usage/usageMath";
import type { ProviderProfile, TaskRecord } from "../src/shared/types";

const PROVIDERS: ProviderProfile[] = [
  {
    id: "openai",
    name: "OpenAI",
    type: "openai-compatible",
    baseUrl: "https://api.openai.com",
    defaultModel: "gpt-4o-mini",
    costPerMillionInput: 0.15,
    costPerMillionOutput: 0.60,
  },
  {
    id: "anthropic",
    name: "Anthropic",
    type: "anthropic",
    baseUrl: "https://api.anthropic.com",
    defaultModel: "claude-3-5-sonnet-latest",
    costPerMillionInput: 3.0,
    costPerMillionOutput: 15.0,
  },
  {
    id: "ollama",
    name: "Ollama",
    type: "ollama",
    baseUrl: "http://localhost:11434",
    defaultModel: "llama3.1",
    // No pricing — local model.
  },
];

function task(
  partial: Partial<TaskRecord> & { id: string; providerId: string; modelId: string },
): TaskRecord {
  return {
    title: partial.title ?? `Task ${partial.id}`,
    prompt: "",
    modeId: "code",
    activeSkills: [],
    status: "completed",
    toolCalls: [],
    messages: [],
    startedAt: 0,
    ...partial,
  };
}

describe("usageMath", () => {
  it("pricingFor returns provider rates when both are set", () => {
    const t = task({ id: "1", providerId: "openai", modelId: "gpt-4o-mini" });
    expect(pricingFor(t, PROVIDERS)).toEqual({ input: 0.15, output: 0.6 });
  });

  it("pricingFor returns undefined when provider is missing or unpriced", () => {
    expect(
      pricingFor(task({ id: "2", providerId: "ollama", modelId: "llama3.1" }), PROVIDERS),
    ).toBeUndefined();
    expect(
      pricingFor(task({ id: "3", providerId: "missing", modelId: "x" }), PROVIDERS),
    ).toBeUndefined();
  });

  it("costForTask scales by 1M tokens", () => {
    const t = task({
      id: "1",
      providerId: "anthropic",
      modelId: "claude-3-5-sonnet-latest",
      inputTokens: 500_000,
      outputTokens: 100_000,
    });
    const c = costForTask(t, PROVIDERS);
    expect(c.priced).toBe(true);
    expect(c.inputCostUsd).toBeCloseTo(1.5, 6); // 0.5M * $3 = $1.5
    expect(c.outputCostUsd).toBeCloseTo(1.5, 6); // 0.1M * $15 = $1.5
    expect(c.totalCostUsd).toBeCloseTo(3.0, 6);
  });

  it("costForTask returns zeros for unpriced provider but keeps priced=false", () => {
    const t = task({
      id: "1",
      providerId: "ollama",
      modelId: "llama3.1",
      inputTokens: 1_000_000,
      outputTokens: 500_000,
    });
    const c = costForTask(t, PROVIDERS);
    expect(c.priced).toBe(false);
    expect(c.totalCostUsd).toBe(0);
  });

  it("aggregateUsage sums per provider, per model, sorted by cost desc", () => {
    const tasks = [
      task({
        id: "1",
        providerId: "openai",
        modelId: "gpt-4o-mini",
        inputTokens: 1_000_000,
        outputTokens: 500_000,
      }), // 0.15 + 0.30 = $0.45
      task({
        id: "2",
        providerId: "openai",
        modelId: "gpt-4o",
        inputTokens: 2_000_000,
        outputTokens: 200_000,
      }), // 0.30 + 0.12 = $0.42
      task({
        id: "3",
        providerId: "anthropic",
        modelId: "claude-3-5-sonnet-latest",
        inputTokens: 100_000,
        outputTokens: 50_000,
      }), // 0.30 + 0.75 = $1.05
      task({
        id: "4",
        providerId: "ollama",
        modelId: "llama3.1",
        inputTokens: 9_999_999,
        outputTokens: 9_999_999,
      }), // unpriced
    ];

    const u = aggregateUsage(tasks, PROVIDERS);
    expect(u.totals.taskCount).toBe(4);
    expect(u.totals.pricedTaskCount).toBe(3);
    expect(u.totals.totalCostUsd).toBeCloseTo(0.45 + 0.42 + 1.05, 6);

    expect(u.byProvider[0].label).toBe("Anthropic");
    expect(u.byProvider[0].totalCostUsd).toBeCloseTo(1.05, 6);
    expect(u.byProvider[1].label).toBe("OpenAI");
    expect(u.byProvider[1].totalCostUsd).toBeCloseTo(0.87, 6);

    // Ollama appears too — unpriced but still bucketed (cost is 0).
    const ollamaBucket = u.byProvider.find((b) => b.key === "ollama");
    expect(ollamaBucket?.totalCostUsd).toBe(0);

    // By model: claude is most expensive single bucket.
    expect(u.byModel[0].key).toBe("claude-3-5-sonnet-latest");
  });
});

describe("usage formatters", () => {
  it("formats USD with up to 4 decimals", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(1.5)).toBe("$1.50");
    expect(formatUsd(0.0123)).toBe("$0.0123");
  });

  it("formats token counts compactly", () => {
    expect(formatTokens(42)).toBe("42");
    expect(formatTokens(1_500)).toBe("1.5k");
    expect(formatTokens(2_300_000)).toBe("2.30M");
  });
});
