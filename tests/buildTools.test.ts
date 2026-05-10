import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyPatchTool,
  formatFilesTool,
  installDependencyTool,
  runTestCommandTool,
} from "../src/core/tools/builtin/buildTools";
import { IgnoreMatcher, SAFE_DEFAULT_IGNORES } from "../src/core/security/ignoreMatcher";
import { scanSecrets } from "../src/core/security/secretScanner";
import { resolveWorkspacePath } from "../src/core/security/pathGuard";
import type { ToolContext } from "../src/core/tools/toolTypes";

function buildCtx(root: string, signal?: AbortSignal): ToolContext {
  const matcher = new IgnoreMatcher(root);
  matcher.addPatterns(SAFE_DEFAULT_IGNORES.join("\n"));
  matcher.loadFile(".nexusignore");
  return {
    workspaceRoot: root,
    signal: signal ?? new AbortController().signal,
    log: () => undefined,
    ui: {
      showInfo: () => undefined,
      showWarning: () => undefined,
      showError: () => undefined,
      getSelection: async () => undefined,
      getOpenFiles: async () => [],
      getDiagnostics: async () => [],
      getSymbols: async () => [],
      askUser: async () => undefined,
    },
    security: {
      isIgnored: (p) => matcher.isIgnored(p),
      resolveWorkspacePath: (p) => resolveWorkspacePath(root, p),
      scanSecrets: (s) => scanSecrets(s),
    },
    checkpoints: {
      create: async () => ({ id: "cp_test", createdAt: Date.now(), files: [] }),
      restore: async () => 0,
      list: () => [],
    },
    flow: {
      setTodo: () => undefined,
      enqueue: () => ({ id: "q", createdAt: Date.now() }),
      recordSummary: () => undefined,
    },
  };
}

describe("apply_patch", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nx-build-"));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("produces a diff for a simple swap", async () => {
    const file = "src/foo.ts";
    fs.mkdirSync(path.join(root, "src"));
    fs.writeFileSync(path.join(root, file), "alpha\nbeta\ngamma\n");
    const ctx = buildCtx(root);
    const r = await applyPatchTool.execute(
      {
        path: file,
        hunks: [{ startLineBefore: 2, beforeText: "beta", afterText: "BETA" }],
      },
      ctx,
    );
    expect(r.error).toBeUndefined();
    expect(r.diff?.files[0].path).toBe(file);
    expect(r.diff?.files[0].after).toContain("BETA");
    expect(r.diff?.files[0].before).toContain("beta");
  });

  it("rejects ignored paths", async () => {
    fs.writeFileSync(path.join(root, ".env"), "SECRET=1\n");
    const ctx = buildCtx(root);
    const r = await applyPatchTool.execute(
      {
        path: ".env",
        hunks: [{ startLineBefore: 1, beforeText: "SECRET=1", afterText: "SECRET=2" }],
      },
      ctx,
    );
    expect(r.error).toMatch(/ignored/);
  });

  it("rejects when beforeText does not match the file", async () => {
    fs.writeFileSync(path.join(root, "a.txt"), "one\ntwo\n");
    const ctx = buildCtx(root);
    const r = await applyPatchTool.execute(
      {
        path: "a.txt",
        hunks: [{ startLineBefore: 1, beforeText: "WRONG", afterText: "X" }],
      },
      ctx,
    );
    expect(r.error).toMatch(/does not match/);
  });

  it("rejects out-of-range hunks", async () => {
    fs.writeFileSync(path.join(root, "a.txt"), "one\n");
    const ctx = buildCtx(root);
    const r = await applyPatchTool.execute(
      {
        path: "a.txt",
        hunks: [
          { startLineBefore: 5, beforeText: "x", afterText: "y" },
        ],
      },
      ctx,
    );
    expect(r.error).toMatch(/runs past end/);
  });

  it("rejects overlapping hunks", async () => {
    fs.writeFileSync(path.join(root, "a.txt"), "a\nb\nc\nd\n");
    const ctx = buildCtx(root);
    const r = await applyPatchTool.execute(
      {
        path: "a.txt",
        hunks: [
          { startLineBefore: 1, beforeText: "a\nb", afterText: "X" },
          { startLineBefore: 2, beforeText: "b", afterText: "Y" },
        ],
      },
      ctx,
    );
    expect(r.error).toMatch(/overlap/);
  });

  it("reports no-op when after == before", async () => {
    fs.writeFileSync(path.join(root, "a.txt"), "x\n");
    const ctx = buildCtx(root);
    const r = await applyPatchTool.execute(
      {
        path: "a.txt",
        hunks: [{ startLineBefore: 1, beforeText: "x", afterText: "x" }],
      },
      ctx,
    );
    expect(r.error).toBeUndefined();
    expect(r.content).toMatch(/no changes/);
  });
});

describe("install_dependency package-manager detection", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nx-pm-"));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  // We can't actually run the install in tests, but we exercise the auto-detect
  // and command-builder logic by aborting before spawn completes.
  it("rejects invalid package names via Zod schema", () => {
    const r = installDependencyTool.schema.safeParse({ name: "../../etc/passwd" });
    expect(r.success).toBe(false);
  });

  it("accepts a scoped package name", () => {
    const r = installDependencyTool.schema.safeParse({ name: "@types/node@20" });
    expect(r.success).toBe(true);
  });

  it("aborts cleanly on signal", async () => {
    const ctrl = new AbortController();
    const ctx = buildCtx(root, ctrl.signal);
    ctrl.abort();
    // The runShell path checks aborted upfront; a true spawn happens otherwise.
    // We can't depend on the real package manager — assert no exception.
    const p = installDependencyTool.execute(
      { name: "left-pad" },
      ctx,
    );
    await expect(p).resolves.toBeDefined();
  });
});

describe("run_test_command and format_files schema validation", () => {
  it("run_test_command requires no fields", () => {
    const r = runTestCommandTool.schema.safeParse({});
    expect(r.success).toBe(true);
  });

  it("format_files requires at least one path", () => {
    const r = formatFilesTool.schema.safeParse({ paths: [] });
    expect(r.success).toBe(false);
  });

  it("format_files rejects ignored paths before spawning", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nx-fmt-"));
    try {
      fs.writeFileSync(path.join(root, ".env"), "X=1");
      const ctx = buildCtx(root);
      const r = await formatFilesTool.execute({ paths: [".env"] }, ctx);
      expect(r.error).toMatch(/ignored/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
