import * as vscode from "vscode";

let channel: vscode.OutputChannel | undefined;

function out(): vscode.OutputChannel {
  if (!channel) channel = vscode.window.createOutputChannel("NexusCode");
  return channel;
}

function ts(): string {
  const d = new Date();
  return d.toISOString();
}

export const logger = {
  info(msg: string, ...args: unknown[]) {
    out().appendLine(`[${ts()}] [info] ${formatArgs(msg, args)}`);
  },
  warn(msg: string, ...args: unknown[]) {
    out().appendLine(`[${ts()}] [warn] ${formatArgs(msg, args)}`);
  },
  error(msg: string, ...args: unknown[]) {
    out().appendLine(`[${ts()}] [error] ${formatArgs(msg, args)}`);
  },
  debug(msg: string, ...args: unknown[]) {
    out().appendLine(`[${ts()}] [debug] ${formatArgs(msg, args)}`);
  },
  show() {
    out().show(true);
  },
};

function formatArgs(msg: string, args: unknown[]): string {
  if (args.length === 0) return msg;
  try {
    const parts = args.map((a) => {
      if (a instanceof Error) return `${a.message}\n${a.stack ?? ""}`;
      if (typeof a === "string") return a;
      return JSON.stringify(a);
    });
    return `${msg} ${parts.join(" ")}`;
  } catch {
    return msg;
  }
}
