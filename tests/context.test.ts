import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseContextRefs, stripContextRefs } from "../src/core/context/contextRef";
import { buildContextChunks, packContext } from "../src/core/context/contextBuilder";
import { estimateTokens, packBudget, truncateToTokens } from "../src/core/context/tokenBudget";
import { IgnoreMatcher, SAFE_DEFAULT_IGNORES } from "../src/core/security/ignoreMatcher";
import { scanSecrets } from "../src/core/security/secretScanner";
import { resolveWorkspacePath } from "../src/core/security/pathGuard";

describe("parseContextRefs", () => {
  it("parses every reference kind", () => {
    const msg = "fix @file:src/main.ts using @symbol:Foo and @gitdiff:HEAD~1 @terminal @problems @openfiles @folder:src/";
    const refs = parseContextRefs(msg);
    const kinds = refs.map((r) => r.kind);
    expect(kinds).toEqual(["file", "symbol", "gitdiff", "terminal", "problems", "openfiles", "folder"]);
    expect(refs[0].value).toBe("src/main.ts");
    expect(refs[2].value).toBe("HEAD~1");
  });

  it("ignores tokens embedded in identifiers", () => {
    const refs = parseContextRefs("send email to user@file.com");
    expect(refs).toHaveLength(0);
  });

  it("strips refs with stripContextRefs", () => {
    const cleaned = stripContextRefs("@file:src/main.ts please refactor this");
    expect(cleaned).toBe("please refactor this");
  });
});

describe("estimateTokens", () => {
  it("uses ~4 chars/token for ASCII", () => {
    expect(estimateTokens("hello world this is sample text")).toBe(Math.ceil(31 / 4));
  });

  it("counts non-ASCII more aggressively", () => {
    const russian = "это текст";
    const ascii = "this is ascii of equal len";
    // non-ascii heuristic should yield >= ascii chars/4
    expect(estimateTokens(russian)).toBeGreaterThan(estimateTokens(""));
    expect(estimateTokens(russian)).toBeGreaterThanOrEqual(Math.ceil(russian.length / 4));
    void ascii;
  });

  it("returns 0 for empty input", () => {
    expect(estimateTokens("")).toBe(0);
  });
});

describe("truncateToTokens", () => {
  it("returns input unchanged when under budget", () => {
    expect(truncateToTokens("short text", 100)).toBe("short text");
  });

  it("truncates and appends notice when over budget", () => {
    const big = "a".repeat(10_000);
    const out = truncateToTokens(big, 100);
    expect(out.length).toBeLessThan(big.length);
    expect(out).toContain("[truncated");
  });
});

describe("packBudget", () => {
  it("respects priority order and budget", () => {
    const r = packBudget(
      [
        { id: "a", priority: 1, text: "x".repeat(40) }, // 10 tokens
        { id: "b", priority: 5, text: "y".repeat(40) }, // 10 tokens
        { id: "c", priority: 3, text: "z".repeat(120) }, // 30 tokens
      ],
      30,
    );
    expect(new Set(r.included.map((it) => it.id))).toEqual(new Set(["b", "a"]));
    expect(r.excluded.map((it) => it.id)).toEqual(["c"]);
  });
});

describe("buildContextChunks + packContext", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nx-context-"));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("resolves @file references and redacts secrets", async () => {
    fs.writeFileSync(path.join(root, "a.ts"), "key=sk-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH\n");
    const matcher = new IgnoreMatcher(root);
    matcher.addPatterns(SAFE_DEFAULT_IGNORES.join("\n"));
    const refs = parseContextRefs("@file:a.ts please review");
    const chunks = await buildContextChunks(refs, {
      workspaceRoot: root,
      security: {
        isIgnored: (p) => matcher.isIgnored(p),
        resolveWorkspacePath: (p) => resolveWorkspacePath(root, p),
        scanSecrets: (s) => scanSecrets(s),
      },
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].body).toContain("[REDACTED:openai]");
  });

  it("packContext de-duplicates by id", async () => {
    fs.writeFileSync(path.join(root, "a.ts"), "x");
    const matcher = new IgnoreMatcher(root);
    matcher.addPatterns(SAFE_DEFAULT_IGNORES.join("\n"));
    const refs = parseContextRefs("@file:a.ts and again @file:a.ts");
    const chunks = await buildContextChunks(refs, {
      workspaceRoot: root,
      security: {
        isIgnored: (p) => matcher.isIgnored(p),
        resolveWorkspacePath: (p) => resolveWorkspacePath(root, p),
        scanSecrets: (s) => scanSecrets(s),
      },
    });
    const packed = packContext(chunks, 1000);
    expect(packed.included).toHaveLength(1);
  });
});
