import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IgnoreMatcher, SAFE_DEFAULT_IGNORES } from "../src/core/security/ignoreMatcher";
import { scanSecrets } from "../src/core/security/secretScanner";
import { resolveWorkspacePath } from "../src/core/security/pathGuard";

describe("IgnoreMatcher", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nx-ignore-"));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("ignores files matching a glob pattern", () => {
    const m = new IgnoreMatcher(root);
    m.addPatterns(["**/*.log", "node_modules/"].join("\n"));
    expect(m.isIgnored(path.join(root, "logs/app.log"))).toBe(true);
    expect(m.isIgnored(path.join(root, "src/main.ts"))).toBe(false);
    expect(m.isIgnored(path.join(root, "node_modules/foo/index.js"))).toBe(true);
  });

  it("supports negation rules with `!`", () => {
    const m = new IgnoreMatcher(root);
    m.addPatterns(["secrets/**", "!secrets/public.txt"].join("\n"));
    expect(m.isIgnored(path.join(root, "secrets/private.key"))).toBe(true);
    expect(m.isIgnored(path.join(root, "secrets/public.txt"))).toBe(false);
  });

  it("loads SAFE_DEFAULT_IGNORES patterns", () => {
    const m = new IgnoreMatcher(root);
    m.addPatterns(SAFE_DEFAULT_IGNORES.join("\n"));
    expect(m.isIgnored(path.join(root, ".env"))).toBe(true);
    expect(m.isIgnored(path.join(root, "deeply/nested/.env.local"))).toBe(true);
    expect(m.isIgnored(path.join(root, "node_modules/foo/index.js"))).toBe(true);
    expect(m.isIgnored(path.join(root, ".git/config"))).toBe(true);
    expect(m.isIgnored(path.join(root, "src/main.ts"))).toBe(false);
  });

  it("loadFile reads a .nexusignore on disk", () => {
    fs.writeFileSync(path.join(root, ".nexusignore"), "*.tmp\n");
    const m = new IgnoreMatcher(root);
    expect(m.loadFile(".nexusignore")).toBe(true);
    expect(m.isIgnored(path.join(root, "a/b/c.tmp"))).toBe(true);
  });
});

describe("scanSecrets", () => {
  it("redacts OpenAI keys", () => {
    const text = "key=sk-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH end";
    const r = scanSecrets(text);
    expect(r.matches.length).toBeGreaterThan(0);
    expect(r.matches[0].type).toBe("openai");
    expect(r.redacted).not.toContain("sk-abcdef");
    expect(r.redacted).toContain("[REDACTED:openai]");
  });

  it("redacts GitHub fine-grained PATs", () => {
    const text = "token: github_pat_11ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcdefghij something";
    const r = scanSecrets(text);
    expect(r.matches.some((m) => m.type === "github-fine-grained-pat")).toBe(true);
  });

  it("redacts private key blocks", () => {
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nABCDEF\n-----END RSA PRIVATE KEY-----";
    const r = scanSecrets(pem);
    expect(r.matches.some((m) => m.type === "private-key")).toBe(true);
    expect(r.redacted).toContain("[REDACTED:private-key]");
  });

  it("does not match plain text", () => {
    const r = scanSecrets("hello world this is fine");
    expect(r.matches).toHaveLength(0);
    expect(r.redacted).toBe("hello world this is fine");
  });
});

describe("resolveWorkspacePath", () => {
  it("rejects traversal", () => {
    expect(() => resolveWorkspacePath("/work", "../escape/x")).toThrow(/escapes/);
  });

  it("resolves relative inside the root", () => {
    const r = resolveWorkspacePath("/work", "src/main.ts");
    expect(r).toBe(path.normalize("/work/src/main.ts"));
  });

  it("rejects absolute outside the root", () => {
    expect(() => resolveWorkspacePath("/work", "/etc/passwd")).toThrow(/escapes/);
  });

  it("accepts the root itself", () => {
    const r = resolveWorkspacePath("/work", ".");
    expect(r).toBe(path.normalize("/work"));
  });
});
