import * as fs from "node:fs";
import * as path from "node:path";
import type { SkillDefinition } from "../../shared/types";

const SKILL_FILE_PATTERN = /\.skill\.json$/i;

/**
 * Walks `<root>/.nexus/skills` (and a few other common locations) and parses
 * every `*.skill.json` file as a `SkillDefinition`. Files that fail to parse
 * are reported in `errors[]` rather than throwing so a single bad file does
 * not disable the rest.
 */
export interface LoadedSkills {
  skills: SkillDefinition[];
  errors: { file: string; error: string }[];
}

export function loadProjectSkills(workspaceRoot: string | undefined): LoadedSkills {
  const out: LoadedSkills = { skills: [], errors: [] };
  if (!workspaceRoot) return out;

  const dirs = [
    path.join(workspaceRoot, ".nexus", "skills"),
    path.join(workspaceRoot, ".vscode", "nexus", "skills"),
  ];
  for (const dir of dirs) {
    if (!safeIsDir(dir)) continue;
    walk(dir, out);
  }
  return out;
}

function walk(dir: string, out: LoadedSkills): void {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      walk(abs, out);
      continue;
    }
    if (!SKILL_FILE_PATTERN.test(e.name)) continue;
    try {
      const text = fs.readFileSync(abs, "utf8");
      const parsed = JSON.parse(text) as SkillDefinition;
      if (!parsed.id || !parsed.name) {
        out.errors.push({ file: abs, error: "missing id or name" });
        continue;
      }
      out.skills.push({
        ...parsed,
        source: parsed.source ?? "project",
        builtIn: false,
        enabled: parsed.enabled ?? true,
      });
    } catch (e) {
      out.errors.push({ file: abs, error: (e as Error).message });
    }
  }
}

function safeIsDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}
