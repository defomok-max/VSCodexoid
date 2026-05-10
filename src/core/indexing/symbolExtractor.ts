/**
 * Lightweight symbol extractor for the workspace index.
 *
 * We deliberately avoid pulling in the full TypeScript compiler — the host
 * bundle stays under 200 KB and indexing is best-effort anyway. Patterns
 * cover the top-level declarations VS Code's outline view would surface for
 * TS/JS files: `function`, `class`, `interface`, `type`, `enum`, `namespace`,
 * `const`, `let`. Methods declared inside a class get a `method` kind via a
 * second-pass scan.
 */
export type SymbolKind =
  | "function"
  | "class"
  | "interface"
  | "type"
  | "enum"
  | "namespace"
  | "const"
  | "let"
  | "method";

export interface SymbolEntry {
  name: string;
  kind: SymbolKind;
  /** 1-based line number where the symbol declaration starts. */
  line: number;
  /** True when the declaration is preceded by an `export` keyword. */
  exported: boolean;
  /** Owning class / namespace name, when applicable. */
  container?: string;
}

const TOP_LEVEL_PATTERNS: Array<{ kind: SymbolKind; re: RegExp }> = [
  { kind: "function", re: /^(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s*\*?\s+([A-Za-z_$][\w$]*)/ },
  { kind: "class", re: /^(?:export\s+(?:default\s+)?)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/ },
  { kind: "interface", re: /^(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/ },
  { kind: "type", re: /^(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\b/ },
  { kind: "enum", re: /^(?:export\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/ },
  { kind: "namespace", re: /^(?:export\s+)?(?:declare\s+)?namespace\s+([A-Za-z_$][\w$]*)/ },
  { kind: "const", re: /^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)/ },
  { kind: "let", re: /^(?:export\s+)?let\s+([A-Za-z_$][\w$]*)/ },
];

const METHOD_RE =
  /^\s*(?:public\s+|private\s+|protected\s+|readonly\s+|static\s+|abstract\s+|override\s+|async\s+|\*\s*)*([A-Za-z_$][\w$]*)\s*[<(]/;

const SUPPORTED_EXT = new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs"]);

export function isSupportedForSymbols(filePath: string): boolean {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return SUPPORTED_EXT.has(ext);
}

export function extractSymbols(filePath: string, content: string): SymbolEntry[] {
  if (!isSupportedForSymbols(filePath)) return [];
  const out: SymbolEntry[] = [];
  const lines = content.split("\n");
  // Track simple class scope by brace counting from the `class` keyword line.
  const classScopes: Array<{ name: string; depth: number }> = [];
  let depth = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();
    // Skip obvious non-declaration lines fast.
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("*")) {
      depth += countBraces(line);
      continue;
    }
    let matchedTopLevel = false;
    for (const p of TOP_LEVEL_PATTERNS) {
      const m = p.re.exec(trimmed);
      if (m) {
        out.push({
          name: m[1],
          kind: p.kind,
          line: i + 1,
          exported: trimmed.startsWith("export"),
          container: classScopes.length > 0 ? classScopes[classScopes.length - 1].name : undefined,
        });
        if (p.kind === "class" || p.kind === "namespace") {
          classScopes.push({ name: m[1], depth });
        }
        matchedTopLevel = true;
        break;
      }
    }
    if (!matchedTopLevel && classScopes.length > 0) {
      const m = METHOD_RE.exec(line);
      // Heuristic: only count as a method when the line is indented (inside a class)
      // and is not a top-level function we already picked up.
      if (
        m &&
        line !== trimmed &&
        !["if", "for", "while", "switch", "return", "throw", "new", "function", "case", "do", "else"].includes(m[1])
      ) {
        out.push({
          name: m[1],
          kind: "method",
          line: i + 1,
          exported: false,
          container: classScopes[classScopes.length - 1].name,
        });
      }
    }
    depth += countBraces(line);
    while (classScopes.length > 0 && depth <= classScopes[classScopes.length - 1].depth) {
      classScopes.pop();
    }
  }
  return out;
}

function countBraces(line: string): number {
  let d = 0;
  let inStr: string | null = null;
  let inLineComment = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inLineComment) break;
    if (inStr) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === "/" && line[i + 1] === "/") {
      inLineComment = true;
      break;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inStr = ch;
      continue;
    }
    if (ch === "{") d++;
    else if (ch === "}") d--;
  }
  return d;
}
