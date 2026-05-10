import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ContextReference } from "./contextRef";
import type { ToolSecurityBridge } from "../tools/toolTypes";
import { packBudget, type BudgetItem } from "./tokenBudget";

/**
 * Resolved chunk of context that will be folded into the prompt.
 */
export interface ContextChunk {
  ref: ContextReference;
  /** Stable id used for de-duplication. */
  id: string;
  title: string;
  body: string;
}

export interface ContextBuilderHostBridge {
  workspaceRoot: string | undefined;
  security: ToolSecurityBridge;
  /** Returns problem messages for the workspace, e.g. from `vscode.languages.getDiagnostics`. */
  getProblems?: () => Promise<{ file: string; line?: number; severity: string; message: string }[]>;
  /** Returns the contents of the most-recent terminal output. */
  getTerminalOutput?: () => Promise<string | undefined>;
  /** Returns currently-open editor files. */
  getOpenFiles?: () => Promise<string[]>;
  /** Returns `git diff` (optionally against a ref). */
  getGitDiff?: (ref?: string) => Promise<string | undefined>;
  /** Resolves a symbol query to file:line[:column] hits via vscode.workspace.getSymbols. */
  findSymbol?: (query: string) => Promise<{ file: string; line: number; preview: string }[] | undefined>;
}

const MAX_FILE_BYTES = 64 * 1024;
const MAX_FOLDER_FILES = 50;

export async function buildContextChunks(
  refs: ContextReference[],
  host: ContextBuilderHostBridge,
): Promise<ContextChunk[]> {
  const out: ContextChunk[] = [];
  for (const ref of refs) {
    try {
      const chunk = await resolveRef(ref, host);
      if (chunk) out.push(chunk);
    } catch (e) {
      out.push({
        ref,
        id: refId(ref),
        title: `${ref.kind}${ref.value ? `:${ref.value}` : ""}`,
        body: `[error resolving reference: ${(e as Error).message}]`,
      });
    }
  }
  return out;
}

function refId(ref: ContextReference): string {
  return `${ref.kind}:${ref.value ?? ""}`;
}

async function resolveRef(
  ref: ContextReference,
  host: ContextBuilderHostBridge,
): Promise<ContextChunk | undefined> {
  switch (ref.kind) {
    case "file": {
      if (!ref.value) return undefined;
      const abs = host.security.resolveWorkspacePath(ref.value);
      if (host.security.isIgnored(abs)) return banner(ref, `[ignored by .nexusignore]`);
      const stat = await fs.stat(abs);
      if (!stat.isFile()) return banner(ref, `[not a file]`);
      let text = await fs.readFile(abs, "utf8");
      if (Buffer.byteLength(text, "utf8") > MAX_FILE_BYTES) {
        text = text.slice(0, MAX_FILE_BYTES) + "\n... [truncated]";
      }
      const { redacted } = host.security.scanSecrets(text);
      return {
        ref,
        id: refId(ref),
        title: `@file:${ref.value}`,
        body: "```\n" + redacted + "\n```",
      };
    }
    case "folder": {
      if (!ref.value) return undefined;
      const abs = host.security.resolveWorkspacePath(ref.value);
      if (host.security.isIgnored(abs)) return banner(ref, `[ignored by .nexusignore]`);
      const stat = await fs.stat(abs);
      if (!stat.isDirectory()) return banner(ref, `[not a folder]`);
      const items: string[] = [];
      const stack = [abs];
      while (stack.length > 0 && items.length < MAX_FOLDER_FILES) {
        const cur = stack.pop()!;
        let entries;
        try {
          entries = await fs.readdir(cur, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const e of entries) {
          const child = path.join(cur, e.name);
          if (host.security.isIgnored(child)) continue;
          const rel = path.relative(host.workspaceRoot ?? abs, child);
          items.push(e.isDirectory() ? rel + "/" : rel);
          if (items.length >= MAX_FOLDER_FILES) break;
          if (e.isDirectory()) stack.push(child);
        }
      }
      items.sort();
      return banner(ref, items.join("\n"));
    }
    case "symbol": {
      if (!ref.value) return undefined;
      const hits = (await host.findSymbol?.(ref.value)) ?? [];
      if (hits.length === 0) return banner(ref, `[no symbol matches]`);
      const lines = hits.slice(0, 10).map((h) => `${h.file}:${h.line}: ${h.preview}`);
      return banner(ref, lines.join("\n"));
    }
    case "terminal": {
      const out = (await host.getTerminalOutput?.()) ?? "";
      const { redacted } = host.security.scanSecrets(out);
      return banner(ref, redacted || "[no recent terminal output]");
    }
    case "problems": {
      const probs = (await host.getProblems?.()) ?? [];
      if (probs.length === 0) return banner(ref, "[no diagnostics]");
      return banner(
        ref,
        probs
          .slice(0, 100)
          .map((p) => `${p.severity}: ${p.file}${p.line ? `:${p.line}` : ""}: ${p.message}`)
          .join("\n"),
      );
    }
    case "gitdiff": {
      const diff = (await host.getGitDiff?.(ref.value)) ?? "";
      const { redacted } = host.security.scanSecrets(diff);
      return banner(ref, redacted || "[no diff]");
    }
    case "openfiles": {
      const files = (await host.getOpenFiles?.()) ?? [];
      return banner(ref, files.join("\n") || "[no files open]");
    }
  }
}

function banner(ref: ContextReference, body: string): ContextChunk {
  const title = `@${ref.kind}${ref.value ? `:${ref.value}` : ""}`;
  return { ref, id: refId(ref), title, body: `### ${title}\n${body}` };
}

/**
 * Packs chunks into a final context string under a token budget. Chunks of
 * the same id are de-duplicated keeping the first occurrence.
 */
export function packContext(
  chunks: ContextChunk[],
  tokenLimit: number,
): { text: string; tokens: number; included: ContextChunk[]; excluded: ContextChunk[] } {
  const seen = new Set<string>();
  const dedup: ContextChunk[] = [];
  for (const c of chunks) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    dedup.push(c);
  }
  const items: BudgetItem[] = dedup.map((c, i) => ({
    id: c.id,
    priority: dedup.length - i, // earlier refs are higher priority
    text: c.body,
  }));
  const packed = packBudget(items, tokenLimit);
  const includedIds = new Set(packed.included.map((it) => it.id));
  return {
    text: packed.text,
    tokens: packed.tokens,
    included: dedup.filter((c) => includedIds.has(c.id)),
    excluded: dedup.filter((c) => !includedIds.has(c.id)),
  };
}
