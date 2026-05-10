import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { extractSymbols, isSupportedForSymbols } from "../src/core/indexing/symbolExtractor";
import { InvertedIndex, tokenize } from "../src/core/indexing/lexicalSearch";
import { WorkspaceIndex } from "../src/core/indexing/workspaceIndex";

describe("symbolExtractor", () => {
  it("ignores unsupported file types", () => {
    expect(isSupportedForSymbols("a.py")).toBe(false);
    expect(extractSymbols("a.py", "def foo(): pass")).toEqual([]);
  });

  it("extracts top-level functions and classes from TypeScript", () => {
    const src = [
      "export function alpha(x: number): number { return x; }",
      "export async function beta() {}",
      "export class Greeter {",
      "  hello(name: string) { return `hi ${name}`; }",
      "  private static build(): Greeter { return new Greeter(); }",
      "}",
      "type Inner = string;",
      "interface Bar { x: number; }",
      "const k = 1;",
      "let m = 2;",
      "namespace NS { export const x = 1; }",
    ].join("\n");
    const symbols = extractSymbols("a.ts", src);
    const summary = symbols.map((s) => `${s.kind} ${s.name}${s.exported ? "*" : ""}`);
    expect(summary).toContain("function alpha*");
    expect(summary).toContain("function beta*");
    expect(summary).toContain("class Greeter*");
    expect(summary).toContain("type Inner");
    expect(summary).toContain("interface Bar");
    expect(summary).toContain("const k");
    expect(summary).toContain("let m");
    expect(summary).toContain("namespace NS");
    const greeter = symbols.find((s) => s.kind === "method" && s.name === "hello");
    expect(greeter?.container).toBe("Greeter");
    const build = symbols.find((s) => s.kind === "method" && s.name === "build");
    expect(build?.container).toBe("Greeter");
  });

  it("does not classify control-flow keywords as methods", () => {
    const src = [
      "class A {",
      "  run() {",
      "    if (true) { return 1; }",
      "    for (let i = 0; i < 10; i++) {}",
      "    while (false) {}",
      "  }",
      "}",
    ].join("\n");
    const methods = extractSymbols("a.ts", src).filter((s) => s.kind === "method");
    const names = methods.map((m) => m.name);
    expect(names).toEqual(["run"]);
  });
});

describe("lexicalSearch", () => {
  it("tokenizes content into normalized terms", () => {
    expect(tokenize("Hello, World! foo_bar 42")).toEqual(["hello", "world", "foo_bar", "42"]);
  });

  it("ranks files by TF·IDF over the inverted index", () => {
    const ix = new InvertedIndex();
    ix.add("a.ts", "alpha alpha alpha beta");
    ix.add("b.ts", "alpha beta beta beta");
    ix.add("c.ts", "gamma");
    const hits = ix.search("alpha");
    expect(hits[0].path).toBe("a.ts");
    expect(hits.find((h) => h.path === "c.ts")).toBeUndefined();
  });

  it("removes a file from both directions of the index", () => {
    const ix = new InvertedIndex();
    ix.add("x.ts", "needle haystack");
    ix.add("y.ts", "haystack only");
    ix.remove("x.ts");
    const hits = ix.search("needle");
    expect(hits).toEqual([]);
    expect(ix.size().files).toBe(1);
  });
});

describe("WorkspaceIndex", () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-index-"));
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("indexes files, finds symbols, and respects ignored paths", async () => {
    await fs.mkdir(path.join(tmp, "src"), { recursive: true });
    await fs.writeFile(
      path.join(tmp, "src", "math.ts"),
      "export function addNumbers(a: number, b: number) { return a + b; }\nexport const PI = 3.14;\n",
    );
    await fs.writeFile(
      path.join(tmp, "src", "utils.ts"),
      "export class StringUtil { reverse(s: string) { return s.split('').reverse().join(''); } }\n",
    );
    await fs.mkdir(path.join(tmp, "node_modules", "ignored"), { recursive: true });
    await fs.writeFile(
      path.join(tmp, "node_modules", "ignored", "secret.ts"),
      "export const SHOULD_NOT_INDEX = 1;\n",
    );

    const index = new WorkspaceIndex(tmp, {
      isIgnored: (p) => p.includes(`${path.sep}node_modules${path.sep}`),
    });
    const stats = await index.refresh();
    expect(stats.files).toBe(2);
    expect(stats.symbols).toBeGreaterThan(0);

    const addNum = index.findSymbol("addNumbers");
    expect(addNum).toHaveLength(1);
    expect(addNum[0].kind).toBe("function");
    expect(addNum[0].file).toBe("src/math.ts");

    const ignoredHit = index.findSymbol("SHOULD_NOT_INDEX");
    expect(ignoredHit).toEqual([]);

    const exportedClasses = index.findSymbol("StringUtil", { kind: "class" });
    expect(exportedClasses).toHaveLength(1);
    expect(exportedClasses[0].exported).toBe(true);

    const search = index.lexicalSearch("reverse string");
    expect(search[0]?.path).toBe("src/utils.ts");
  });

  it("re-indexes changed files and drops removed files on refresh", async () => {
    const file = path.join(tmp, "a.ts");
    await fs.writeFile(file, "export function first() {}\n");

    const index = new WorkspaceIndex(tmp, { isIgnored: () => false });
    await index.refresh();
    expect(index.findSymbol("first")).toHaveLength(1);

    // Force a new mtime + content.
    await new Promise((r) => setTimeout(r, 10));
    await fs.writeFile(file, "export function second() {}\n");
    await index.refresh();
    expect(index.findSymbol("first")).toHaveLength(0);
    expect(index.findSymbol("second")).toHaveLength(1);

    await fs.rm(file);
    await index.refresh();
    expect(index.findSymbol("second")).toHaveLength(0);
    expect(index.stats().files).toBe(0);
  });

  it("regex matcher narrows symbol search", async () => {
    await fs.writeFile(
      path.join(tmp, "a.ts"),
      "export function loadUser() {}\nexport function loadOrder() {}\nexport function deleteUser() {}\n",
    );
    const index = new WorkspaceIndex(tmp, { isIgnored: () => false });
    await index.refresh();
    const hits = index.findSymbol("^load", { regex: true });
    expect(hits.map((h) => h.name).sort()).toEqual(["loadOrder", "loadUser"]);
  });
});
