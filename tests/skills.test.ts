import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SkillRegistry } from "../src/core/skills/skillRegistry";
import { BUILT_IN_SKILLS } from "../src/core/skills/builtInSkills";
import { loadProjectSkills } from "../src/core/skills/skillLoader";

describe("BUILT_IN_SKILLS", () => {
  it("ships at least 20 skills", () => {
    expect(BUILT_IN_SKILLS.length).toBeGreaterThanOrEqual(20);
  });

  it("every skill has unique ids and required fields", () => {
    const ids = new Set<string>();
    for (const s of BUILT_IN_SKILLS) {
      expect(ids.has(s.id)).toBe(false);
      ids.add(s.id);
      expect(s.name).toBeTruthy();
      expect(s.description).toBeTruthy();
      expect(s.builtIn).toBe(true);
      expect(s.source).toBe("built-in");
    }
  });
});

describe("SkillRegistry", () => {
  it("registers and lists skills", () => {
    const r = new SkillRegistry();
    r.registerMany(BUILT_IN_SKILLS);
    expect(r.list().length).toBe(BUILT_IN_SKILLS.length);
  });

  it("matches skills by trigger substring (case-insensitive)", () => {
    const r = new SkillRegistry();
    r.registerMany(BUILT_IN_SKILLS);
    const matches = r.match("Please FIX BUG in the auth module");
    expect(matches.some((s) => s.id === "nexus.fix-bug")).toBe(true);
  });

  it("does not match disabled skills", () => {
    const r = new SkillRegistry();
    r.register({
      id: "x",
      name: "x",
      description: "x",
      triggers: ["foo"],
      enabled: false,
    });
    expect(r.match("foo")).toHaveLength(0);
  });
});

describe("loadProjectSkills", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nx-skills-"));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("loads valid *.skill.json files from .nexus/skills", () => {
    const dir = path.join(root, ".nexus", "skills");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "my.skill.json"),
      JSON.stringify({
        id: "user.my-skill",
        name: "My Skill",
        description: "demo",
        triggers: ["demo"],
      }),
    );
    const r = loadProjectSkills(root);
    expect(r.skills).toHaveLength(1);
    expect(r.skills[0].source).toBe("project");
    expect(r.errors).toHaveLength(0);
  });

  it("reports errors for invalid skill JSON without throwing", () => {
    const dir = path.join(root, ".nexus", "skills");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "broken.skill.json"), "{not valid json");
    const r = loadProjectSkills(root);
    expect(r.skills).toHaveLength(0);
    expect(r.errors).toHaveLength(1);
  });

  it("reports missing required fields", () => {
    const dir = path.join(root, ".nexus", "skills");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "missing.skill.json"), JSON.stringify({ description: "x" }));
    const r = loadProjectSkills(root);
    expect(r.skills).toHaveLength(0);
    expect(r.errors[0].error).toMatch(/id or name/);
  });
});
