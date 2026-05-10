import type { DiffPreviewFile } from "../../shared/types";
import { applyHunkMask } from "./patchEngine";

export interface DiffSession {
  taskId: string;
  files: DiffPreviewFile[];
}

export interface DiffDecisionResult {
  session?: DiffSession;
  file?: DiffPreviewFile;
  changed: boolean;
}

export function setHunkDecision(
  session: DiffSession,
  path: string,
  hunkId: string,
  accepted: boolean,
): DiffDecisionResult {
  return updateFile(session, path, (file) => {
    const hunk = file.hunks.find((h) => h.id === hunkId);
    if (!hunk) return { file, changed: false };
    if (hunk.accepted === accepted) return { file, changed: false };
    return {
      file: {
        ...file,
        hunks: file.hunks.map((h) => (h.id === hunkId ? { ...h, accepted } : h)),
      },
      changed: true,
    };
  });
}

export function setFileDecision(
  session: DiffSession,
  path: string,
  accepted: boolean,
): DiffDecisionResult {
  return updateFile(session, path, (file) => {
    const nextHunks = file.hunks.map((h) => ({ ...h, accepted }));
    const changed = file.hunks.some((h) => h.accepted !== accepted);
    return { file: { ...file, hunks: nextHunks }, changed };
  });
}

export function setAllDecision(session: DiffSession, accepted: boolean): DiffSession {
  return {
    ...session,
    files: session.files.map((file) => ({
      ...file,
      hunks: file.hunks.map((h) => ({ ...h, accepted })),
    })),
  };
}

export function isDiffSessionResolved(session: DiffSession): boolean {
  return session.files.every((file) => file.hunks.every((h) => h.accepted !== null));
}

export function materializeAcceptedFiles(session: DiffSession): DiffPreviewFile[] {
  return session.files
    .map((file) => {
      const accepted = file.hunks.map((h) => h.accepted === true);
      const after = applyHunkMask(file.before, file.hunks, accepted);
      return { ...file, after };
    })
    .filter((file) => file.after !== file.before);
}

function updateFile(
  session: DiffSession,
  path: string,
  fn: (file: DiffPreviewFile) => { file: DiffPreviewFile; changed: boolean },
): DiffDecisionResult {
  const index = session.files.findIndex((file) => file.path === path);
  if (index < 0) return { session, changed: false };
  const { file, changed } = fn(session.files[index]);
  if (!changed) return { session, file, changed: false };
  const files = session.files.slice();
  files[index] = file;
  return { session: { ...session, files }, file, changed: true };
}
