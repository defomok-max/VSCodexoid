import * as path from "node:path";

/**
 * Resolves a workspace-relative or absolute path to an absolute path within
 * `root`. Throws on traversal (`..`-style escapes) and on absolute paths that
 * fall outside the workspace.
 */
export function resolveWorkspacePath(root: string | undefined, input: string): string {
  if (!input || typeof input !== "string") throw new Error("path required");
  if (!root) {
    if (path.isAbsolute(input)) return path.normalize(input);
    throw new Error("workspace root unknown — supply an absolute path");
  }
  const abs = path.isAbsolute(input) ? path.normalize(input) : path.resolve(root, input);
  const rootResolved = path.resolve(root);
  if (abs !== rootResolved && !abs.startsWith(rootResolved + path.sep)) {
    throw new Error(`path "${input}" escapes the workspace root`);
  }
  return abs;
}
