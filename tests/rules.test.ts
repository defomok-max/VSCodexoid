import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildRulesSection, loadNexusRules } from "../src/core/rules/rulesLoader";

describe("loadNexusRules", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nx-rules-"));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("returns undefined when no rules file exists", () => {
    expect(loadNexusRules(root)).toBeUndefined();
  });

  it("loads .nexusrules from workspace root", () => {
    fs.writeFileSync(path.join(root, ".nexusrules"), "Always write tests.\n");
    expect(loadNexusRules(root)).toBe("Always write tests.");
  });

  it("falls back to .nexus/rules.md", () => {
    fs.mkdirSync(path.join(root, ".nexus"), { recursive: true });
    fs.writeFileSync(path.join(root, ".nexus", "rules.md"), "# Rules\nUse pnpm.\n");
    expect(loadNexusRules(root)).toContain("Use pnpm");
  });

  it("returns undefined for empty file", () => {
    fs.writeFileSync(path.join(root, ".nexusrules"), "   \n\n");
    expect(loadNexusRules(root)).toBeUndefined();
  });
});

describe("buildRulesSection", () => {
  it("returns empty string when rules are undefined", () => {
    expect(buildRulesSection(undefined)).toBe("");
  });

  it("wraps rules in a banner", () => {
    const text = buildRulesSection("write tests");
    expect(text).toContain("PROJECT RULES");
    expect(text).toContain("write tests");
  });
});
