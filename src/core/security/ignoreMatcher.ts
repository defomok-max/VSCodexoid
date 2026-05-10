import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Tiny gitignore-style matcher. Supports:
 *   - `*` and `**` globs
 *   - `?` single-char
 *   - leading `!` for negation
 *   - leading `/` to anchor at workspace root
 *   - trailing `/` to require directories
 *   - comments (`#`) and blank lines
 *
 * Not a full implementation of the gitignore grammar — just enough for the
 * agent's read/write/grep guards.
 */
export class IgnoreMatcher {
  private rules: Rule[] = [];
  private root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  /** Adds patterns from a string (one pattern per line). */
  addPatterns(text: string): void {
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      this.rules.push(parsePattern(line));
    }
  }

  /** Loads patterns from a file at `<root>/<name>` if it exists. */
  loadFile(name: string): boolean {
    const full = path.join(this.root, name);
    try {
      if (!fs.statSync(full).isFile()) return false;
      this.addPatterns(fs.readFileSync(full, "utf8"));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Returns `true` if `absPath` is ignored. The last matching rule wins; a
   * negated rule (`!pattern`) un-ignores.
   */
  isIgnored(absPath: string): boolean {
    const rel = toPosix(path.relative(this.root, path.resolve(absPath)));
    if (rel.startsWith("..")) return false; // outside workspace; let caller decide
    let ignored = false;
    for (const rule of this.rules) {
      if (rule.regex.test(rel) || rule.regex.test("/" + rel)) {
        ignored = !rule.negated;
      }
    }
    return ignored;
  }
}

/** Always-on built-in ignore prefixes for safety (secrets, build outputs). */
export const SAFE_DEFAULT_IGNORES = [
  ".env",
  ".env.*",
  "**/.env",
  "**/.env.*",
  "**/secrets/**",
  "**/credentials/**",
  "**/.aws/**",
  "**/.ssh/**",
  "**/id_rsa",
  "**/id_ed25519",
  "**/.npmrc",
  "**/.pypirc",
  "**/*.pem",
  "**/*.key",
  "**/*.pfx",
  "**/*.p12",
  "**/.git/**",
  "**/.git",
  "**/node_modules/**",
  "**/node_modules",
  "**/dist/**",
  "**/dist",
  "**/build/**",
  "**/build",
  "**/.next/**",
  "**/.next",
  "**/.turbo/**",
  "**/.turbo",
  "**/.cache/**",
  "**/.cache",
];

interface Rule {
  pattern: string;
  regex: RegExp;
  negated: boolean;
}

function parsePattern(input: string): Rule {
  let pat = input;
  let negated = false;
  if (pat.startsWith("!")) {
    negated = true;
    pat = pat.slice(1);
  }
  const anchored = pat.startsWith("/");
  if (anchored) pat = pat.slice(1);
  let trailingSlash = false;
  if (pat.endsWith("/")) {
    trailingSlash = true;
    pat = pat.slice(0, -1);
  }
  const re = globToRegex(pat, anchored, trailingSlash);
  return { pattern: input, regex: re, negated };
}

function globToRegex(pat: string, anchored: boolean, trailingSlash: boolean): RegExp {
  let out = "";
  let i = 0;
  while (i < pat.length) {
    const c = pat[i];
    if (c === "*") {
      if (pat[i + 1] === "*") {
        // **/
        if (pat[i + 2] === "/") {
          out += "(?:.*/)?";
          i += 3;
        } else {
          out += ".*";
          i += 2;
        }
      } else {
        out += "[^/]*";
        i += 1;
      }
    } else if (c === "?") {
      out += "[^/]";
      i += 1;
    } else if (/[.+^${}()|\\[\]]/.test(c)) {
      out += "\\" + c;
      i += 1;
    } else {
      out += c;
      i += 1;
    }
  }
  const prefix = anchored ? "^" : "(^|.*/)";
  const suffix = trailingSlash ? "(/.*)?$" : "(/.*)?$";
  return new RegExp(prefix + out + suffix);
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}
