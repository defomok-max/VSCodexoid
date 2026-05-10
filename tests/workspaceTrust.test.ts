import { describe, expect, it } from "vitest";
import {
  filterToolsForTrust,
  isToolAllowedWhenUntrusted,
  UNTRUSTED_ALLOWED_CATEGORIES,
} from "../src/core/security/workspaceTrust";
import type { ToolCategory } from "../src/core/tools/toolTypes";
import type { RiskLevel } from "../src/shared/types";

function tool(id: string, category: ToolCategory, riskLevel: RiskLevel) {
  return { id, name: id, category, riskLevel };
}

describe("workspaceTrust.isToolAllowedWhenUntrusted", () => {
  it("allows safe-risk tools in read/search/diagnostics/ui/todo categories", () => {
    expect(isToolAllowedWhenUntrusted(tool("read_file", "read", "safe"))).toBe(true);
    expect(isToolAllowedWhenUntrusted(tool("search", "search", "safe"))).toBe(true);
    expect(isToolAllowedWhenUntrusted(tool("get_diagnostics", "diagnostics", "safe"))).toBe(true);
    expect(isToolAllowedWhenUntrusted(tool("ask_user", "ui", "safe"))).toBe(true);
    expect(isToolAllowedWhenUntrusted(tool("update_todo_list", "todo", "safe"))).toBe(true);
  });

  it("rejects tools in mutating categories (edit / shell / git / network / checkpoint)", () => {
    expect(isToolAllowedWhenUntrusted(tool("write_file", "edit", "safe"))).toBe(false);
    expect(isToolAllowedWhenUntrusted(tool("run_terminal_command", "shell", "safe"))).toBe(false);
    expect(isToolAllowedWhenUntrusted(tool("git_commit", "git", "safe"))).toBe(false);
    expect(isToolAllowedWhenUntrusted(tool("http_get", "network", "safe"))).toBe(false);
    expect(isToolAllowedWhenUntrusted(tool("restore_checkpoint", "checkpoint", "safe"))).toBe(false);
  });

  it("rejects allowed-category tools whose static risk is above safe", () => {
    expect(isToolAllowedWhenUntrusted(tool("noisy_read", "read", "low"))).toBe(false);
    expect(isToolAllowedWhenUntrusted(tool("noisy_read", "read", "medium"))).toBe(false);
    expect(isToolAllowedWhenUntrusted(tool("noisy_read", "read", "high"))).toBe(false);
    expect(isToolAllowedWhenUntrusted(tool("noisy_read", "read", "critical"))).toBe(false);
  });
});

describe("workspaceTrust.filterToolsForTrust", () => {
  const tools = [
    tool("read_file", "read", "safe"),
    tool("search", "search", "safe"),
    tool("get_symbols", "diagnostics", "safe"),
    tool("ask_user", "ui", "safe"),
    tool("update_todo_list", "todo", "safe"),
    tool("write_file", "edit", "medium"),
    tool("delete_file", "edit", "high"),
    tool("run_terminal_command", "shell", "high"),
    tool("git_commit", "git", "medium"),
    tool("restore_checkpoint", "checkpoint", "high"),
  ];

  it("returns the full list verbatim when trusted", () => {
    const out = filterToolsForTrust(tools, { isTrusted: true });
    expect(out.map((t) => t.id)).toEqual(tools.map((t) => t.id));
    // Returns a fresh array (not the same reference) so callers can't mutate input.
    expect(out).not.toBe(tools);
  });

  it("returns only safe read-only tools when untrusted", () => {
    const out = filterToolsForTrust(tools, { isTrusted: false });
    expect(out.map((t) => t.id).sort()).toEqual(
      ["ask_user", "get_symbols", "read_file", "search", "update_todo_list"].sort(),
    );
  });

  it("UNTRUSTED_ALLOWED_CATEGORIES is the documented safe set", () => {
    expect([...UNTRUSTED_ALLOWED_CATEGORIES].sort()).toEqual(
      ["diagnostics", "read", "search", "todo", "ui"].sort(),
    );
  });
});
