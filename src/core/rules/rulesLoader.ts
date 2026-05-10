import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Reads a `.nexusrules` file from the workspace root if present. The file is
 * plain markdown / text and is concatenated into the system prompt verbatim.
 *
 * Returns `undefined` when the file is missing or empty so the caller can
 * skip the system-prompt section entirely.
 */
export function loadNexusRules(workspaceRoot: string | undefined): string | undefined {
  if (!workspaceRoot) return undefined;
  const candidates = [
    path.join(workspaceRoot, ".nexusrules"),
    path.join(workspaceRoot, ".nexus", "rules.md"),
  ];
  for (const candidate of candidates) {
    try {
      const stat = fs.statSync(candidate);
      if (!stat.isFile()) continue;
      const text = fs.readFileSync(candidate, "utf8").trim();
      if (text.length === 0) continue;
      return text;
    } catch {
      // missing file — try next candidate
    }
  }
  return undefined;
}

/**
 * Builds the project-rules section of the system prompt. The agent runner
 * concatenates this with the active mode's system prompt and any custom
 * instructions from settings.
 */
export function buildRulesSection(rules: string | undefined): string {
  if (!rules) return "";
  return `--- PROJECT RULES (.nexusrules) ---\n${rules}\n--- END PROJECT RULES ---`;
}
