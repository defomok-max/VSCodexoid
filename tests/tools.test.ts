import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ToolRegistry } from "../src/core/tools/toolRegistry";
import { registerBuiltinTools, BUILTIN_TOOL_IDS } from "../src/core/tools/builtin";
import { IgnoreMatcher, SAFE_DEFAULT_IGNORES } from "../src/core/security/ignoreMatcher";
import { scanSecrets } from "../src/core/security/secretScanner";
import { resolveWorkspacePath } from "../src/core/security/pathGuard";
import type { ToolContext } from "../src/core/tools/toolTypes";

function buildCtx(root: string): ToolContext {
  const matcher = new IgnoreMatcher(root);
  matcher.addPatterns(SAFE_DEFAULT_IGNORES.join("\n"));
  return {
    workspaceRoot: root,
    signal: new AbortController().signal,
    log: () => undefined,
    ui: {
      showInfo: () => undefined,
      showWarning: () => undefined,
      showError: () => undefined,
      getSelection: async () => undefined,
      getOpenFiles: async () => [],
      getDiagnostics: async () => [],
      getSymbols: async () => [],
      askUser: async () => undefined,
    },
    security: {
      isIgnored: (p) => matcher.isIgnored(p),
      resolveWorkspacePath: (p) => resolveWorkspacePath(root, p),
      scanSecrets: (s) => scanSecrets(s),
    },
  };
}

describe("ToolRegistry", () => {
  it("lists every built-in tool", () => {
    const reg = new ToolRegistry();
    registerBuiltinTools(reg);
    expect(new Set(reg.ids())).toEqual(new Set(BUILTIN_TOOL_IDS));
  });

  it("filters by allowed list", () => {
    const reg = new ToolRegistry();
    registerBuiltinTools(reg);
    const filtered = reg.list({ allowed: ["read_file", "grep"] });
    expect(filtered.map((t) => t.id).sort()).toEqual(["grep", "read_file"]);
  });
});

describe("file tools", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nx-tools-"));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("read_file returns text and redacts secrets", async () => {
    fs.writeFileSync(path.join(root, "a.txt"), "key=sk-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH\n");
    const reg = new ToolRegistry();
    registerBuiltinTools(reg);
    const ctx = buildCtx(root);
    const r = await reg.get("read_file")!.execute({ path: "a.txt" }, ctx);
    expect(r.content).toContain("[REDACTED:openai]");
  });

  it("read_file refuses to read .nexusignore'd files", async () => {
    fs.writeFileSync(path.join(root, ".env"), "SECRET=1\n");
    const reg = new ToolRegistry();
    registerBuiltinTools(reg);
    const ctx = buildCtx(root);
    const r = await reg.get("read_file")!.execute({ path: ".env" }, ctx);
    expect(r.error).toMatch(/ignored/);
  });

  it("write_file produces a diff preview without writing to disk", async () => {
    fs.writeFileSync(path.join(root, "a.txt"), "hello\n");
    const reg = new ToolRegistry();
    registerBuiltinTools(reg);
    const ctx = buildCtx(root);
    const r = await reg
      .get("write_file")!
      .execute({ path: "a.txt", content: "hello world\n" }, ctx);
    expect(r.diff?.files[0]?.path).toBe("a.txt");
    expect(r.diff?.files[0]?.before).toBe("hello\n");
    expect(r.diff?.files[0]?.after).toBe("hello world\n");
    expect(fs.readFileSync(path.join(root, "a.txt"), "utf8")).toBe("hello\n");
  });

  it("edit_file refuses ambiguous oldText", async () => {
    fs.writeFileSync(path.join(root, "a.txt"), "foo\nfoo\n");
    const reg = new ToolRegistry();
    registerBuiltinTools(reg);
    const ctx = buildCtx(root);
    const r = await reg
      .get("edit_file")!
      .execute({ path: "a.txt", oldText: "foo", newText: "bar" }, ctx);
    expect(r.error).toMatch(/ambiguous/);
  });

  it("list_files honors ignore", async () => {
    fs.mkdirSync(path.join(root, "src"));
    fs.writeFileSync(path.join(root, "src/main.ts"), "x");
    fs.writeFileSync(path.join(root, ".env"), "x");
    fs.mkdirSync(path.join(root, "node_modules/foo"), { recursive: true });
    fs.writeFileSync(path.join(root, "node_modules/foo/index.js"), "x");
    const reg = new ToolRegistry();
    registerBuiltinTools(reg);
    const ctx = buildCtx(root);
    const r = await reg.get("list_files")!.execute({ path: ".", recursive: true }, ctx);
    expect(r.content).toContain("src/main.ts");
    expect(r.content).not.toContain(".env");
    expect(r.content).not.toContain("node_modules");
  });
});
